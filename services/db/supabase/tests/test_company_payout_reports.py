"""Frozen payout economics, administrator access, and complete evidence validation."""

from decimal import Decimal

import psycopg

from services.db.supabase.tests.payout_fixtures import payout_snapshot, report_records
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class CompanyPayoutReportTests(SourceModelFixture):
    def report(self, company: str, **scope: object) -> str:
        return self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "change_reason": "Save exact source and terms inputs",
                **scope,
            },
        )

    def reassign(self, identity: str, company: str | None) -> str:
        row = self.connection.execute(
            "select native_id,current_version_id from public.assignment_keys where id=%s",
            (identity,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected SKU identity.")
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
                "sku": row[0],
                "company_id": company,
                "expected_current_version_id": str(row[1]),
                "change_reason": "Change current ownership",
                "periods": [],
            },
        )

    def test_manifest_retains_other_company_terms_used_to_exclude_rows(self) -> None:
        company, identity = self.owner()
        _, other_identity = self.owner("OTHER")
        own_terms = self.fee(identity, [("2026-01-01", None, "5")])
        other_terms = self.fee(other_identity, [("2026-01-01", None, "10")])
        self.finances([self.transaction("100"), self.transaction("200", 4, sku="OTHER")])
        report = self.report(company)
        self.assertEqual(
            set(
                self.connection.execute(
                    "select version_id::text from private.payout_report_assignment_versions "
                    "where report_id=%s",
                    (report,),
                ).fetchall()
            ),
            {(own_terms,), (other_terms,)},
        )
        before = payout_snapshot(self, report)
        self.reassign(other_identity, company)
        self.assertEqual(payout_snapshot(self, report), before)
        self.assertEqual([row["sku"] for row in report_records(self, report)], ["SKU"])
        self.connection.execute("set constraints all immediate")

    def test_company_report_access_survives_sku_transfer(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        old_user, new_user = self.member(company), self.member(other_company)
        administrator = self.administrator()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        report = self.report(company)
        self.reassign(identity, other_company)
        self.connection.execute("set constraints all immediate")
        for user, months in (
            (administrator, ["2026-06-01"]),
            (old_user, ["2026-06-01"]),
            (new_user, []),
        ):
            self.assertEqual(
                self.as_user(user, "select public.payout_search_months()::text[]"), [(months,)]
            )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.as_user(self.auth_user(), "select public.payout_search_months()")

        self.assertEqual(
            self.as_user(administrator, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            [
                Decimal(row["company_amount"])
                for row in report_records(self, report, user=administrator)
            ],
            [Decimal(95)],
        )
        self.assertEqual(
            self.as_user(old_user, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            [Decimal(row["company_amount"]) for row in report_records(self, report, user=old_user)],
            [Decimal(95)],
        )
        self.assertEqual(self.as_user(new_user, "select * from public.company_payout_reports"), [])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            report_records(self, report, user=new_user)
        self.assertEqual(self.as_user(old_user, "select id from private.finances_amounts"), [])
        self.assertEqual(self.as_user(old_user, "select id from public.assignment_versions"), [])
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (administrator,)
        )
        self.assertEqual(
            self.as_user(administrator, "select id from public.company_payout_reports"), []
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            report_records(self, report, user=administrator)

    def test_incomplete_ownership_fees_and_source_coverage_fail_atomically(self) -> None:
        company, identity = self.owner()
        self.finances([self.transaction("100")])
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.report(company)
        self.reassign(identity, None)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.report(company)
        self.reassign(identity, company)
        self.fee(identity, [("2026-01-01", None, "0")])
        for scope in (
            {"preprocess_version": "another-version"},
            {"finances_version_ids": [new_id()]},
            {"marketplace_name": "Unsupported marketplace"},
        ):
            with (
                self.subTest(scope=scope),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.report(company, **scope)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        report = self.report(company)
        self.assertEqual(
            self.connection.execute(
                "select fee_amount,company_amount from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(100)),
        )
        self.connection.execute("set constraints all immediate")

    def test_refund_uses_its_posting_date_rate_without_overcredit_adjustment(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", "2026-06-15", "5"), ("2026-06-15", None, "7")])
        self.finances(
            [
                self.transaction("100", activity_date="2026-06-14"),
                self.transaction("-100", 4, kind="Refund"),
            ]
        )
        report = self.report(company)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(2), Decimal(2)),
        )
        self.connection.execute("set constraints all immediate")
