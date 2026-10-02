"""Exercise the typed Python financial repositories against the real database."""

from datetime import date
from decimal import Decimal

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.database.company_terms import FeePeriod, create_company, publish_sku_terms
from services.sync.src.database.financial_reads import load_company_financial_progress
from services.sync.src.database.payout_reports import (
    load_company_payout_report,
    load_company_payout_report_components,
    publish_company_payout_report,
)
from services.sync.src.numeric import Numeric


class FinancialRepositoryTests(SourceModelFixture):
    def test_partial_reader_preserves_exact_missing_fee_details(self) -> None:
        database = TransactionDatabase(self.connection)
        company = create_company(database, "Partial sums")
        for sku, periods in (
            ("SKU", [FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric(10))]),
            ("MISSING", []),
        ):
            publish_sku_terms(
                database,
                sku=sku,
                company_id=company,
                expected_current_version_id=None,
                periods=periods,
                change_reason="Initial terms",
            )
        settlement, _ = self.settlement(
            [
                self.transaction("100"),
                self.transaction("200", 4, sku="MISSING"),
                self.transaction("-5", 5, description="Shipping"),
            ]
        )
        progress = load_company_financial_progress(
            database,
            seller_namespace=self.seller,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 30),
            preprocess_version="v0",
            settlement_ids=[settlement],
            marketplace_names=[],
        )[0]
        self.assertEqual(
            (progress.source_amount, progress.known_fee_amount, progress.known_company_amount),
            (Decimal(295), Decimal(-10), Decimal(85)),
        )
        self.assertEqual(progress.missing_fee_count, 1)
        self.assertEqual(progress.missing_fee_components[0].source_amount, Decimal(200))
        self.assertEqual(progress.missing_fee_components[0].fee_base, Decimal(200))

    def test_report_repository_reads_frozen_amounts_after_unassignment(self) -> None:
        database = TransactionDatabase(self.connection)
        company = create_company(database, "Saved report")
        terms = publish_sku_terms(
            database,
            sku="SKU",
            company_id=company,
            expected_current_version_id=None,
            periods=[FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric("5.123456"))],
            change_reason="Initial terms",
        )
        self.settlement([self.transaction("100")])
        fill_payout_kiosk_month(self)
        report_id = publish_company_payout_report(
            database,
            company_id=company,
            currency="USD",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 30),
            report_name="June report",
            change_reason="Freeze source and terms",
        )
        before = load_company_payout_report(database, report_id)
        components = load_company_payout_report_components(database, report_id)
        if before is None:
            self.fail("Expected saved report.")
        self.assertEqual(before.fee_amount, Decimal("-5.123456"))
        self.assertEqual(before.company_amount, Decimal("94.876544"))
        self.assertEqual(before.marketplace_names, ("Amazon.com",))
        self.assertEqual(components[0].terms_version_id, terms)
        publish_sku_terms(
            database,
            sku="SKU",
            company_id=None,
            expected_current_version_id=terms,
            periods=[],
            change_reason="Unassign current SKU",
        )
        self.assertEqual(load_company_payout_report(database, report_id), before)
        self.assertEqual(load_company_payout_report_components(database, report_id), components)
