"""Exact financial reader results and explicit coverage arguments."""

import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid7

from ....src.database.financial_reads import (
    CompanyFinancialProgress,
    load_company_financial_progress,
    load_company_financial_totals,
)
from ...support.fakes import FakeDatabaseConnection


class TestFinancialReads(unittest.TestCase):
    def test_retains_exact_values_and_separate_currencies(self) -> None:
        company_id, settlement_id = str(uuid7()), str(uuid7())
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (company_id, "EUR", Decimal("0.01"), Decimal("-0.0005"), Decimal("0.0095")),
                    (company_id, "USD", Decimal("-100"), Decimal("7"), Decimal("-93")),
                    (company_id, "JPY", Decimal("1e1000"), Decimal("0"), Decimal("1e1000")),
                ]
            ]
        )
        totals = load_company_financial_totals(
            database,
            seller_namespace="seller",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 2),
            preprocess_version="v0",
            settlement_ids=[settlement_id, settlement_id],
            marketplace_names=["Amazon.com"],
        )
        self.assertEqual(totals[0].company_amount, Decimal("0.0095"))
        self.assertEqual(totals[1].fee_amount, Decimal(7))
        self.assertEqual(totals[2].company_amount, Decimal("1e1000"))
        self.assertEqual(database.execute_calls[0][1]["settlement_ids"], [settlement_id])

    def test_null_fee_is_never_turned_into_a_complete_total(self) -> None:
        database = FakeDatabaseConnection(
            fetchall_results=[[(str(uuid7()), "USD", Decimal(1), None, None)]]
        )
        with self.assertRaisesRegex(RuntimeError, "Decimal"):
            load_company_financial_totals(
                database,
                seller_namespace="seller",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 1),
                preprocess_version="v0",
                settlement_ids=[str(uuid7())],
                marketplace_names=[],
            )

    def test_partial_sums_keep_missing_component_exact_and_separate(self) -> None:
        detail = self.missing_component()
        database = FakeDatabaseConnection(
            fetchall_results=[
                [(str(uuid7()), "USD", Decimal(295), Decimal(-10), Decimal(85), 1, [detail])]
            ]
        )
        progress = self.progress(database)[0]
        self.assertEqual(progress.source_amount, Decimal(295))
        self.assertEqual(progress.known_company_amount, Decimal(85))
        self.assertEqual(progress.known_fee_amount, Decimal(-10))
        self.assertTrue(progress.has_missing_fees)
        self.assertEqual(progress.missing_fee_components[0].source_amount, Decimal(200))
        self.assertEqual(progress.missing_fee_components[0].sku, " SKU ")
        self.assertEqual(
            progress.missing_fee_components[0].fee_base, Decimal("200.123456789123456789")
        )

    def test_all_missing_fees_leave_calculated_sums_null(self) -> None:
        database = FakeDatabaseConnection(
            fetchall_results=[
                [(str(uuid7()), "USD", Decimal(200), None, None, 1, [self.missing_component()])]
            ]
        )
        progress = self.progress(database)[0]
        self.assertIsNone(progress.known_fee_amount)
        self.assertIsNone(progress.known_company_amount)

    def test_missing_component_count_or_float_amount_cannot_pass(self) -> None:
        for count, details in (
            (2, [self.missing_component()]),
            (1, [self.missing_component() | {"source_amount": 0.1}]),
        ):
            database = FakeDatabaseConnection(
                fetchall_results=[[(str(uuid7()), "USD", Decimal(200), None, None, count, details)]]
            )
            with self.subTest(count=count), self.assertRaises(RuntimeError):
                self.progress(database)

    @staticmethod
    def progress(database: FakeDatabaseConnection) -> tuple[CompanyFinancialProgress, ...]:
        return load_company_financial_progress(
            database,
            seller_namespace="seller",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 1),
            preprocess_version="v0",
            settlement_ids=[],
            marketplace_names=[],
        )

    @staticmethod
    def missing_component() -> dict[str, object]:
        return {
            "source": "SETTLEMENT",
            "source_row_id": str(uuid7()),
            "source_version_id": str(uuid7()),
            "source_identity_id": str(uuid7()),
            "seller_namespace": "seller",
            "sku": " SKU ",
            "marketplace_name": "Amazon.com",
            "activity_date": "2026-01-01",
            "currency": "USD",
            "source_amount": "200",
            "fee_base": "200.123456789123456789",
            "sku_id": str(uuid7()),
            "terms_version_id": str(uuid7()),
            "resolution_status": "MISSING_FEE",
        }


if __name__ == "__main__":
    unittest.main()
