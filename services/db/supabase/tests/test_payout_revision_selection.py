"""Payout inputs are scoped immutable revisions, not capture or processing runs."""

from decimal import Decimal

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    payout_snapshot,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutRevisionSelectionTests(SourceModelFixture):
    def report(self, company: str) -> str:
        return self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "change_reason": "Record exact selected contents and successful coverage",
            },
        )

    def test_reports_store_totals_and_inputs_without_copied_details_or_calculator_versions(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        self.assertEqual(
            self.connection.execute(
                "select to_regclass('public.company_payout_report_components'),"
                "exists(select 1 from pg_attribute "
                "where attrelid='public.company_payout_reports'::regclass "
                "and attname='calculation_version' and not attisdropped)"
            ).fetchone(),
            (None, False),
        )
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount,record_count "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (100, -5, 95, 1),
        )

    def test_changed_partial_capture_can_mix_current_finance_revisions(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("50", 4, activity_date="2026-06-16"),
            ]
        )
        first = publish_payout(self, inputs)
        before = payout_snapshot(self, first)
        partial = self.acquisition(start="2026-06-15", end="2026-06-15")
        batch, changed = self.finances([self.transaction("120")], acquisition_id=partial)
        second = publish_payout(self, inputs)
        self.assertNotEqual(second, first)
        self.assertEqual(self.finances_versions(batch), [changed])
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount,source_version_count "
                "from public.company_payout_reports where id=%s",
                (second,),
            ).fetchone(),
            (170, Decimal("-8.5"), Decimal("161.5"), 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select v.total_amount from private.payout_report_source_versions p "
                "join private.finances_transactions v on v.version_id=p.version_id "
                "where p.report_id=%s order by v.posted_date",
                (second,),
            ).fetchall(),
            [(120,), (50,)],
        )
        self.assertEqual(payout_snapshot(self, first), before)
        self.connection.execute("set constraints all immediate")

    def test_coverage_is_saved_for_the_complete_month(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        coverage = require_row(
            self.connection.execute(
                "select source_coverage from public.company_payout_reports where id=%s", (report,)
            ).fetchone()
        )[0]
        self.assertEqual(
            coverage,
            [
                {
                    "source": "FINANCES",
                    "seller_namespace": self.seller,
                    "marketplace_name": "Amazon.com",
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-30",
                }
            ],
        )
