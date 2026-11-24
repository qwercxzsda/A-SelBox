"""Exercise the typed Python financial repositories against the real database."""

from datetime import date
from decimal import Decimal

import psycopg

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.database.company_terms import FeePeriod, create_company, publish_sku_terms
from services.sync.src.database.payout_reports import (
    load_company_payout_report,
    load_company_payout_report_records,
    publish_company_payout_report,
)
from services.sync.src.numeric import Numeric


class FinancialRepositoryTests(SourceModelFixture):
    def test_report_repository_rejects_company_without_assigned_skus(self) -> None:
        database = TransactionDatabase(self.connection)
        company = create_company(database, "Not assigned yet")
        with self.assertRaises(psycopg.errors.CheckViolation):
            publish_company_payout_report(
                database,
                company_id=company,
                marketplace_name=None,
                currency=None,
                start_date=date(2026, 6, 1),
                end_date=date(2026, 6, 30),
                change_reason="No assignments cannot create a payout",
            )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )

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
        self.finances([self.transaction("100")])
        report_id = publish_company_payout_report(
            database,
            company_id=company,
            marketplace_name="Amazon.com",
            currency="USD",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 30),
            change_reason="Freeze source and terms",
        )
        before = load_company_payout_report(database, report_id)
        components = load_company_payout_report_records(database, report_id)
        if before is None:
            self.fail("Expected saved report.")
        self.assertEqual(before.fee_amount, Decimal("-5.123456"))
        self.assertEqual(before.company_amount, Decimal("94.876544"))
        self.assertEqual(before.marketplace_name, "Amazon.com")
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
        self.assertEqual(load_company_payout_report_records(database, report_id), components)
