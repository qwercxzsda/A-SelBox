"""Only unused companies can be deleted through the administrator RPC."""

import json
from typing import cast

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

DELETE_COMPANY = "select id::text,deleted from public.delete_company(%s)"


class CompanyDeletionTests(SourceModelFixture):
    def empty_company(self) -> str:
        company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Unused company')", (company,)
        )
        return company

    def delete(self, administrator: str, company: str | None) -> tuple[str, bool]:
        return cast(tuple[str, bool], self.as_user(administrator, DELETE_COMPANY, (company,))[0])

    def blockers(self, administrator: str, company: str) -> list[dict[str, object]]:
        with self.assertRaises(psycopg.Error) as raised:
            self.delete(administrator, company)
        error = raised.exception
        self.assertEqual(error.sqlstate, "PT409")
        self.assertEqual(
            error.diag.message_primary, "Company cannot be deleted while it has linked records"
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.companies where id=%s", (company,)
            ).fetchone(),
            (1,),
        )
        return cast(list[dict[str, object]], json.loads(error.diag.message_detail or "null"))

    def test_unused_company_deletes_and_missing_company_retry_makes_no_write(self) -> None:
        administrator, company = self.administrator(), self.empty_company()
        self.connection.commit()
        revision_query = "select public.workspace_revisions(array['fees'])->'revisions'->>'fees'"
        before = self.as_user(administrator, revision_query)
        self.connection.execute("select 1")
        self.assertEqual(self.delete(administrator, company), (company, True))
        self.assertEqual(self.as_user(administrator, revision_query), before)
        self.connection.commit()
        after = self.as_user(administrator, revision_query)
        self.assertNotEqual(after, before)
        self.assertEqual(self.delete(administrator, company), (company, False))
        self.connection.commit()
        self.assertEqual(self.as_user(administrator, revision_query), after)
        self.assertEqual(self.as_user(administrator, "select id from public.companies"), [])
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.delete(administrator, None)

    def test_nonadministrators_cannot_delete_or_probe_existence(self) -> None:
        company, missing = self.empty_company(), new_id()
        member, unassigned = self.member(company), self.auth_user()
        self.connection.execute(
            "select set_config('request.jwt.claims',"
            '\'{"user_metadata":{"access_role":"administrator"}}\',true)'
        )
        for caller in (member, unassigned):
            for target in (company, missing, None):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.delete(caller, target)
        for role in ("anon", "service_role"):
            with (
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute(f"set local role {role}")
                self.connection.execute(DELETE_COMPANY, (company,))
        administrator = self.administrator()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(administrator, "delete from public.companies returning id")
        self.connection.execute(
            "select private.set_administrator_access(%s,false)", (administrator,)
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.delete(administrator, company)

    def test_members_block_deletion_and_remain_assigned(self) -> None:
        administrator, company = self.administrator(), self.empty_company()
        member = self.member(company)
        self.member(company)
        self.assertEqual(self.blockers(administrator, company), [{"code": "members", "count": 2}])
        self.assertEqual(
            self.as_user(member, "select company_id::text from public.app_accounts"), [(company,)]
        )

    def test_current_and_historical_zero_period_terms_block_deletion(self) -> None:
        administrator = self.administrator()
        company, sku = self.owner()
        self.assertEqual(
            self.blockers(administrator, company),
            [{"code": "assigned_skus", "count": 1}, {"code": "terms_versions", "count": 1}],
        )
        self.assertEqual(
            self.connection.execute("select count(*) from public.sku_fee_periods").fetchone(),
            (0,),
        )
        current = self.connection.execute(
            "select current_terms_version_id::text from public.skus where id=%s", (sku,)
        ).fetchone()
        self.assertIsNotNone(current)
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": sku,
                "sku": "SKU",
                "company_id": None,
                "expected_current_version_id": cast(tuple[str], current)[0],
                "change_reason": "Unassign current ownership",
                "periods": [],
            },
        )
        self.assertEqual(
            self.blockers(administrator, company), [{"code": "terms_versions", "count": 1}]
        )

    def test_payout_refresh_records_block_deletion_even_without_reports(self) -> None:
        administrator, company = self.administrator(), self.empty_company()
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month) "
            "values (%s,'2026-06-01')",
            (company,),
        )
        self.assertEqual(
            self.blockers(administrator, company), [{"code": "payout_refreshes", "count": 1}]
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state where company_id=%s",
                (company,),
            ).fetchone(),
            (1,),
        )

    def test_all_blockers_are_reported_together_and_saved_history_is_unchanged(self) -> None:
        administrator = self.administrator()
        company, sku = self.owner()
        self.member(company)
        self.fee(sku, [("2026-01-01", None, "5")])
        self.connection.execute(
            "insert into public.company_payout_reports (company_id,currency,start_date,end_date,"
            "dataset_key,marketplace_names,report_name,change_reason,calculation_version,"
            "component_count,reconciliation_count,settlement_version_count,"
            "data_kiosk_version_count,terms_version_count,source_amount,fee_amount,company_amount) "
            "values (%s,null,'2026-06-01','2026-06-30','economics','{}','Empty report',"
            "'Retained history','v1',0,0,0,0,0,0,0,0)",
            (company,),
        )
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month) "
            "values (%s,'2026-06-01')",
            (company,),
        )
        self.assertEqual(
            self.blockers(administrator, company),
            [
                {"code": "members", "count": 1},
                {"code": "assigned_skus", "count": 1},
                {"code": "terms_versions", "count": 2},
                {"code": "payout_reports", "count": 1},
                {"code": "payout_refreshes", "count": 1},
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from public.sku_fee_periods),"
                "(select count(*) from public.sku_terms_versions),"
                "(select count(*) from public.company_payout_reports),"
                "(select count(*) from private.payout_report_refresh_state)"
            ).fetchone(),
            (1, 2, 1, 1),
        )

    def test_unknown_restrictive_foreign_key_fails_closed_without_leaking_table_names(self) -> None:
        administrator, company = self.administrator(), self.empty_company()
        self.connection.execute(
            "create table private.future_company_dependency "
            "(company_id uuid references public.companies(id))"
        )
        self.connection.execute(
            "insert into private.future_company_dependency values (%s)", (company,)
        )
        self.assertEqual(
            self.blockers(administrator, company), [{"code": "other_records", "count": 1}]
        )
