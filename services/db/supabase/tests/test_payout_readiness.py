"""Bounded payout readiness is private, actionable, and independent of financial calculations."""

from datetime import date
from typing import cast

from psycopg.errors import InsufficientPrivilege, InvalidParameterValue

from services.db.supabase.tests.payout_fixtures import prepare_payout, refresh_payout_reports
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutReadinessTests(SourceModelFixture):
    def statuses(self, user: str, company: str | None = None) -> list[tuple[object, ...]]:
        return self.as_user(
            user,
            "select company_id::text,status,reason,has_report from public.payout_readiness("
            "'2026-06-01',%s::uuid[],100,0) order by company_id",
            (None if company is None else [company],),
        )

    def test_company_visibility_and_private_errors_are_not_exposed(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, _ = self.owner()
        other, _ = self.owner("OTHER")
        administrator, member, unassigned = (
            self.administrator(),
            self.member(company),
            self.auth_user(),
        )
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month,failure_count,"
            "last_error_sqlstate,last_error_message) values(%s,'2026-06-01',1,'23514',%s)",
            (company, "Unresolved ownership SECRET-OTHER-SKU"),
        )
        self.assertEqual(self.statuses(member), [(company, "BLOCKED", "SETUP_REQUIRED", False)])
        self.assertEqual(len(self.statuses(administrator)), 2)
        with self.assertRaises(InsufficientPrivilege):
            self.statuses(member, other)
        with self.assertRaises(InsufficientPrivilege):
            self.statuses(unassigned)
        with self.assertRaises(InsufficientPrivilege):
            self.as_user(member, "select * from private.payout_report_refresh_state")
        with self.assertRaises(InsufficientPrivilege):
            self.as_user(
                member, "select * from public.payout_setup_blockers(%s,'2026-06-01')", (company,)
            )
        self.assertEqual(
            self.connection.execute(
                "select has_function_privilege('anon',"
                "'public.payout_readiness(date,uuid[],integer,bigint)','EXECUTE'),"
                "has_function_privilege('service_role',"
                "'public.payout_readiness(date,uuid[],integer,bigint)','EXECUTE')"
            ).fetchone(),
            (False, False),
        )

    def test_pending_complete_empty_and_update_states_follow_existing_worker(self) -> None:
        inputs = prepare_payout(self)
        empty_company, _ = self.owner("NO-SALES")
        administrator = self.administrator()
        self.assertEqual(
            self.statuses(administrator, inputs.company), [(inputs.company, "PENDING", None, False)]
        )
        refresh_payout_reports(self)
        self.assertEqual(
            self.statuses(administrator, inputs.company), [(inputs.company, "COMPLETE", None, True)]
        )
        self.assertEqual(
            self.statuses(administrator, empty_company),
            [(empty_company, "NO_ACTIVITY", None, True)],
        )
        before = self.connection.execute(
            "select count(*),sum(company_amount) from public.company_payout_reports"
        ).fetchone()
        self.connection.execute(
            "update private.payout_report_refresh_state "
            "set requested_revision=requested_revision+1 "
            "where company_id=%s and month='2026-06-01'",
            (inputs.company,),
        )
        self.assertEqual(
            self.statuses(administrator, inputs.company), [(inputs.company, "UPDATING", None, True)]
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(company_amount) from public.company_payout_reports"
            ).fetchone(),
            before,
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select status from public.payout_readiness('2026-07-01',array[%s::uuid])",
                (inputs.company,),
            ),
            [("IMMATURE",)],
        )

    def test_stale_failure_does_not_keep_setup_blocked_after_a_new_request(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, _ = self.owner()
        administrator = self.administrator()
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month,failure_count,"
            "last_error_sqlstate,last_error_message) values(%s,'2026-06-01',2,'23514',"
            "'Unresolved ownership or fee coverage prevents a complete payout report')",
            (company,),
        )
        self.assertEqual(
            self.statuses(administrator, company)[0][1:3], ("BLOCKED", "SETUP_REQUIRED")
        )
        self.connection.execute(
            "select private.request_payout_report_refresh("
            "array[date '2026-06-01'],array[%s::uuid])",
            (company,),
        )
        self.assertEqual(self.statuses(administrator, company)[0][1:3], ("PENDING", None))

    def test_blockers_are_scoped_to_month_and_company_authority_including_zero(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        company, _ = self.owner("KNOWN")
        self.owner("OTHER")
        self.finances(
            [
                self.transaction("10", sku="KNOWN"),
                self.transaction("0", 4, sku="UNASSIGNED"),
                self.transaction("20", 5, sku="OTHER"),
                self.transaction("30", 6, sku="OUTSIDE-MONTH", activity_date="2026-07-01"),
            ]
        )
        self.kiosk(1, [self.component("-3", sku="UNKNOWN-DK")])
        administrator = self.administrator()
        rows = self.as_user(
            administrator,
            "select sku,reason,first_date,last_date,component_count "
            "from public.payout_setup_blockers(%s,'2026-06-01',100,0)",
            (company,),
        )
        self.assertEqual(
            rows,
            [
                ("KNOWN", "MISSING_FEE", date(2026, 6, 15), date(2026, 6, 15), 1),
                ("UNASSIGNED", "MISSING_OWNERSHIP", date(2026, 6, 15), date(2026, 6, 15), 1),
                ("UNKNOWN-DK", "MISSING_OWNERSHIP", date(2026, 6, 15), date(2026, 6, 15), 1),
            ],
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select sku from public.payout_setup_blockers(%s,'2026-06-01',1,1)",
                (company,),
            ),
            [("UNASSIGNED",)],
        )

    def test_readiness_is_bounded_and_does_not_read_source_facts(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        companies = [self.owner(f"SKU-{index}")[0] for index in range(3)]
        administrator = self.administrator()
        before = self.connection.execute(
            "select count(*) from private.payout_report_refresh_state"
        ).fetchone()
        self.connection.execute(
            "create or replace function private.payout_company_sellers(p_company_id uuid) "
            "returns text[] language plpgsql as $$ begin raise exception "
            "'Readiness must not discover source history'; end $$"
        )
        first = self.as_user(
            administrator,
            "select company_id::text from public.payout_readiness('2026-06-01',null,2,0)",
        )
        last = self.as_user(
            administrator,
            "select company_id::text from public.payout_readiness('2026-06-01',null,2,2)",
        )
        self.assertEqual({row[0] for row in [*first, *last]}, set(companies))
        self.assertEqual((len(first), len(last)), (2, 1))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state"
            ).fetchone(),
            before,
        )
        for month, limit, offset in (
            (None, 25, 0),
            ("2026-06-02", 25, 0),
            ("infinity", 25, 0),
            ("2026-06-01", 101, 0),
            ("2026-06-01", 25, -1),
        ):
            with (
                self.subTest(month=month, limit=limit, offset=offset),
                self.assertRaises(InvalidParameterValue),
            ):
                self.as_user(
                    administrator,
                    "select * from public.payout_readiness(%s,null,%s,%s)",
                    (month, limit, offset),
                )

    def test_readiness_changes_rotate_only_the_affected_company_payout_token(self) -> None:
        company, _ = self.owner()
        other, _ = self.owner("OTHER")
        member, other_member = self.member(company), self.member(other)
        self.connection.commit()

        def revision(user: str) -> str:
            return cast(
                str,
                self.as_user(
                    user,
                    "select public.workspace_revisions(array['payouts'])->'revisions'->>'payouts'",
                )[0][0],
            )

        before, other_before = revision(member), revision(other_member)
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month) "
            "values(%s,'2026-06-01')",
            (company,),
        )
        self.connection.commit()
        pending = revision(member)
        self.assertNotEqual(pending, before)
        self.assertEqual(revision(other_member), other_before)
        self.connection.execute(
            "update private.payout_report_refresh_state set failure_count=1,"
            "last_error_sqlstate='23514',last_error_message='Unresolved ownership' "
            "where company_id=%s",
            (company,),
        )
        self.connection.commit()
        self.assertNotEqual(revision(member), pending)
        self.assertEqual(revision(other_member), other_before)
