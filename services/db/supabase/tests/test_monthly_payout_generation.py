"""Monthly publication, authoritative totals, and caller-bound payout access."""

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.payout_fixtures import (
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    publish_report,
    report_records,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class MonthlyPayoutGenerationTests(SourceModelFixture):
    def prepared_company(self) -> str:
        return prepare_payout(self).company

    def generate(self, company: str, month: date = date(2026, 6, 1)) -> str:
        rows = generate_payout_reports(self, company, month)
        self.assertEqual(len(rows), 1)
        return rows[0][0]

    def test_other_company_missing_fee_does_not_block_own_report(self) -> None:
        company, identity = self.owner()
        self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100"), self.transaction("200", 4, sku="OTHER")])
        report = self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select company_amount from public.company_payout_reports where id=%s", (report,)
            ).fetchone(),
            (Decimal(95),),
        )
        self.connection.execute("set constraints all immediate")

    def test_reading_source_aggregates_does_not_mutate_saved_report_inputs(self) -> None:
        company = self.prepared_company()
        report = self.generate(company)
        before = payout_snapshot(self, report)
        self.assertTrue(report_records(self, report, user=self.administrator()))
        self.assertEqual(payout_snapshot(self, report), before)
        self.connection.execute("set constraints all immediate")

    def test_deferred_integrity_runs_for_internal_generation_without_a_login(self) -> None:
        company = self.prepared_company()
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")
        with self.connection.transaction():
            self.connection.execute(
                "select * from private.generate_company_payout_reports(%s,'2026-06-01')", (company,)
            ).fetchall()
            self.connection.execute("set constraints all immediate")

    def test_no_application_user_can_generate_and_own_frozen_rows_are_visible(self) -> None:
        company = self.prepared_company()
        own_member = self.member(company)
        other_company, _ = self.owner("OTHER")
        other_member = self.member(other_company)
        report = self.generate(company)
        for user in (self.administrator(), own_member, other_member, self.auth_user()):
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(
                    user,
                    "select * from private.generate_company_payout_reports(%s,'2026-06-01')",
                    (company,),
                )
        self.assertEqual(
            self.as_user(own_member, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            self.as_user(other_member, "select * from public.company_payout_reports"), []
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(other_member, "select public.payout_report_records(%s)", (report,))

    def test_generation_requires_exact_mature_month_and_allows_empty_history(self) -> None:
        company = self.prepared_company()
        mature_cutoff_date = self.mature_cutoff_date()
        for month in (date(2026, 6, 15), mature_cutoff_date.replace(day=1), date(2030, 1, 1)):
            with self.subTest(month=month), self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.generate(company, month)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        self.finances([], acquisition_id=self.acquisition(start="2025-01-01", end="2025-01-31"))
        report = self.generate(company, date(2025, 1, 1))
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(0), Decimal(0)),
        )

    def test_month_end_equal_to_mature_cutoff_date_is_ineligible_until_the_following_day(
        self,
    ) -> None:
        company = self.prepared_company()
        self.set_mature_cutoff_date(date(2026, 6, 30))
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.generate(company)
        self.set_mature_cutoff_date(date(2026, 7, 1))
        self.generate(company)
        self.connection.execute("set constraints all immediate")

    def test_private_publisher_enforces_month_and_mature_cutoff_date(self) -> None:
        company = self.prepared_company()
        mature_cutoff_date = self.mature_cutoff_date()
        current_month = mature_cutoff_date.replace(day=1)
        current_month_end = current_month.replace(
            day=monthrange(current_month.year, current_month.month)[1]
        )
        for start, end in (
            ("2026-06-15", "2026-06-15"),
            (current_month.isoformat(), current_month_end.isoformat()),
        ):
            with (
                self.subTest(start=start),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
                self.connection.transaction(),
            ):
                publish_report(self, company, start_date=start, end_date=end)

    def test_policy_uses_database_mature_cutoff_date(self) -> None:
        company, _ = self.owner()
        policy = cast(
            dict[str, object],
            self.as_user(self.member(company), "select public.payout_report_policy()")[0][0],
        )
        mature_cutoff_date = self.mature_cutoff_date()
        self.assertEqual(policy["mature_cutoff_date"], mature_cutoff_date.isoformat())
        self.assertEqual(policy["mature_cutoff_months"], 2)
        self.assertEqual(
            policy["latest_month"],
            (mature_cutoff_date.replace(day=1) - timedelta(days=1)).replace(day=1).isoformat(),
        )
        self.connection.execute("set constraints all immediate")
