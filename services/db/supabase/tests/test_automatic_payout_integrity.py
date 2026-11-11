"""Automatic payout work stays isolated, privileged, and visible through cheap tokens."""

from typing import LiteralString, cast

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL, require_row
from services.db.supabase.tests.payout_fixtures import prepare_payout, refresh_payout_reports
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class AutomaticPayoutIntegrityTests(SourceModelFixture):
    def revisions(self, user: str) -> dict[str, str]:
        response = self.as_user(user, "select public.workspace_revisions()")
        return cast(dict[str, str], cast(dict[str, object], response[0][0])["revisions"])

    def test_deferred_failure_rolls_back_only_its_company_month(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("OTHER")
        # Inject a failure into the actual deferred header check. The worker must
        # roll back only that nonempty company/month, leaving the empty one valid.
        # Matching words without a structured reason must not become a setup error.
        validation = str(
            require_row(
                self.connection.execute(
                    "select pg_get_functiondef("
                    "'private.check_company_payout_report()'::regprocedure)"
                ).fetchone()
            )[0]
        )
        rejected = validation.replace(
            "begin\n",
            "begin\n if new.component_count>0 then raise exception "
            "'Unresolved ownership test failure' using errcode='23514'; end if;\n",
            1,
        )
        self.assertNotEqual(rejected, validation)
        self.connection.execute(cast(LiteralString, rejected))
        self.assertEqual(refresh_payout_reports(self), (2, 1, 0, 1))
        self.connection.commit()
        self.assertEqual(
            self.connection.execute(
                "select company_id::text from public.company_payout_reports"
            ).fetchall(),
            [(other,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select last_error_sqlstate,last_error_message,last_failure_reason "
                "from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (inputs.company,),
            ).fetchone(),
            ("23514", "Unresolved ownership test failure", "PROCESSING_FAILED"),
        )
        self.connection.execute(cast(LiteralString, validation))
        self.connection.execute(
            "update private.payout_report_refresh_state set next_attempt_at='-infinity' "
            "where company_id=%s and month='2026-06-01'",
            (inputs.company,),
        )
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.connection.commit()

    def test_overlapping_worker_skips_and_completed_work_stays_idle(self) -> None:
        prepare_payout(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with psycopg.connect(database_url) as winner, psycopg.connect(database_url) as contender:
            winner.execute("set statement_timeout='3s'")
            contender.execute("set statement_timeout='3s'")
            self.assertEqual(
                winner.execute("select * from private.refresh_company_payout_reports()").fetchone(),
                (1, 1, 0, 0),
            )
            self.assertEqual(
                contender.execute(
                    "select * from private.refresh_company_payout_reports()"
                ).fetchone(),
                (0, 0, 0, 0),
            )
            contender.commit()
            winner.commit()
            self.assertEqual(
                contender.execute(
                    "select * from private.refresh_company_payout_reports()"
                ).fetchone(),
                (0, 0, 0, 0),
            )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (1,),
        )

    def test_payout_revision_is_company_scoped_and_only_changes_for_inserted_reports(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("OTHER")
        member, other_member, administrator = (
            self.member(inputs.company),
            self.member(other),
            self.administrator(),
        )
        self.connection.commit()
        before = {user: self.revisions(user) for user in (member, other_member, administrator)}
        with self.connection.transaction():
            self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
            # Deferred publication tokens describe committed financial snapshots.
            self.assertEqual(self.revisions(member), before[member])
        first = {user: self.revisions(user) for user in before}
        for user in (member, administrator):
            self.assertNotEqual(first[user]["payouts"], before[user]["payouts"])
            self.assertEqual(
                {key: value for key, value in first[user].items() if key != "payouts"},
                {key: value for key, value in before[user].items() if key != "payouts"},
            )
        self.assertEqual(first[other_member], before[other_member])
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.connection.commit()
        self.assertEqual(self.revisions(member), first[member])
        self.assertNotEqual(self.revisions(other_member)["payouts"], first[other_member]["payouts"])
        final = {user: self.revisions(user) for user in before}
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.connection.commit()
        self.assertEqual({user: self.revisions(user) for user in before}, final)

    def test_payout_polls_do_not_scan_reports_or_source_inputs(self) -> None:
        inputs = prepare_payout(self)
        member = self.member(inputs.company)
        refresh_payout_reports(self)
        self.connection.commit()
        query = (
            "select relname,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch "
            "from pg_stat_xact_user_tables where relname in "
            "('company_payout_reports','payout_report_finances_versions','payout_report_data_kiosk_versions',"
            "'finances_transaction_components','data_kiosk_day_components') order by relname"
        )
        before = self.connection.execute(query).fetchall()
        tokens = self.revisions(member)
        self.assertEqual(self.revisions(member), tokens)
        self.assertEqual(self.connection.execute(query).fetchall(), before)

    def test_automatic_worker_and_state_have_no_application_api_access(self) -> None:
        company, _ = self.owner()
        for user in (self.administrator(), self.member(company), self.auth_user()):
            for query in (
                "select * from private.refresh_company_payout_reports()",
                "select * from private.payout_report_refresh_state",
            ):
                with (
                    self.subTest(user=user, query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, query)
        self.assertEqual(
            self.connection.execute(
                "select to_regprocedure('public.generate_company_payout_reports(uuid,date)')"
            ).fetchone(),
            (None,),
        )
        for role in ("anon", "authenticated", "service_role"):
            self.assertEqual(
                self.connection.execute(
                    "select has_function_privilege(%s,"
                    "'private.refresh_company_payout_reports(integer)','execute'),"
                    "has_table_privilege(%s,'private.payout_report_refresh_state','select')",
                    (role, role),
                ).fetchone(),
                (False, False),
            )
            for helper in (
                "private.request_payout_report_refresh(date[],uuid[])",
                "private.request_all_payout_report_refreshes(uuid[])",
                "private.ensure_payout_report_months()",
                "private.lock_payout_report_inputs()",
                "private.lock_payout_refresh_requests()",
            ):
                with self.subTest(role=role, helper=helper):
                    self.assertEqual(
                        self.connection.execute(
                            "select has_function_privilege(%s,%s,'execute')", (role, helper)
                        ).fetchone(),
                        (False,),
                    )
        self.assertEqual(
            self.connection.execute(
                "select prosecdef from pg_proc "
                "where oid='private.refresh_company_payout_reports(integer)'::regprocedure"
            ).fetchone(),
            (False,),
        )
