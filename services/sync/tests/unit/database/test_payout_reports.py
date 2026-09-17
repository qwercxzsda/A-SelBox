"""Exact immutable report reads and explicit publication scope."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import cast
from unittest.mock import patch
from uuid import uuid7

from psycopg.types.json import Jsonb

from ....src.database.payout_reports import (
    load_company_payout_report,
    load_company_payout_report_components,
    publish_company_payout_report,
)
from ...support.fakes import FakeDatabaseConnection


class TestPayoutReports(unittest.TestCase):
    def test_publication_sends_scope_without_caller_calculated_amounts(self) -> None:
        report_id, company_id, settlement_id = uuid7(), str(uuid7()), str(uuid7())
        database = FakeDatabaseConnection([(report_id,)])
        with patch("services.sync.src.database.payout_reports.uuid7", return_value=report_id):
            result = publish_company_payout_report(
                database,
                company_id=company_id,
                seller_namespace="seller",
                currency="USD",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 2),
                preprocess_version="v0",
                settlement_ids=[settlement_id, settlement_id],
                marketplace_names=["Amazon.com", "Amazon.com"],
                report_name="January report",
                change_reason="Initial saved report",
            )
        self.assertEqual(result, str(report_id))
        self.assertEqual(database.connection_obj.transaction_count, 1)
        statement, parameters = database.execute_calls[0]
        self.assertIn("private.publish_company_payout_report", statement)
        payload = cast(dict[str, object], cast(Jsonb, parameters["payload"]).obj)
        self.assertEqual(payload["settlement_ids"], [settlement_id])
        self.assertEqual(payload["marketplace_names"], ["Amazon.com"])
        self.assertEqual(payload["start_date"], "2026-01-01")
        self.assertEqual(payload["end_date"], "2026-01-02")
        self.assertNotIn("company_amount", payload)
        self.assertNotIn("fee_amount", payload)
        self.assertNotIn("source_versions", payload)

    def test_saved_header_retains_exact_totals_and_declared_marketplaces(self) -> None:
        report_id, company_id = str(uuid7()), str(uuid7())
        header = (
            report_id,
            company_id,
            "seller",
            "JPY",
            date(2026, 1, 1),
            date(2026, 1, 2),
            "v0",
            "economics",
            ["Amazon.co.jp"],
            "January",
            "Initial",
            "v0",
            1,
            1,
            2,
            1,
            Decimal("1e1000"),
            Decimal("-0.123456789123456789"),
            Decimal("1e1000"),
            datetime(2026, 1, 3, tzinfo=UTC),
        )
        database = FakeDatabaseConnection([header])
        report = load_company_payout_report(database, report_id)
        self.assertIsNotNone(report)
        if report is None:
            self.fail("Expected saved report.")
        self.assertEqual(report.source_amount, Decimal("1e1000"))
        self.assertEqual(report.fee_amount, Decimal("-0.123456789123456789"))
        self.assertEqual(report.marketplace_names, ("Amazon.co.jp",))
        self.assertNotIn("current_", database.execute_calls[0][0])

    def test_cost_component_retains_terms_reference_without_a_fee_period(self) -> None:
        ids = [str(uuid7()) for _ in range(8)]
        component = (
            ids[0],
            ids[1],
            1,
            "DATA_KIOSK",
            ids[2],
            ids[3],
            ids[4],
            ids[5],
            ids[6],
            None,
            " SKU ",
            "Amazon.com",
            date(2026, 1, 1),
            "FbaStorageFee",
            Decimal("-5.123456789123456789"),
            None,
            None,
            None,
            Decimal(0),
            Decimal("-5.123456789123456789"),
            "NOT_APPLICABLE",
        )
        database = FakeDatabaseConnection(fetchall_results=[[component]])
        result = load_company_payout_report_components(database, ids[1])[0]
        self.assertEqual(result.terms_version_id, ids[6])
        self.assertIsNone(result.fee_period_id)
        self.assertIsNone(result.fee_base)
        self.assertEqual(result.sku, " SKU ")
        self.assertEqual(result.company_amount, Decimal("-5.123456789123456789"))

    def test_missing_report_is_not_synthesized(self) -> None:
        self.assertIsNone(load_company_payout_report(FakeDatabaseConnection([None]), str(uuid7())))

    def test_invalid_scope_fails_before_publication(self) -> None:
        for currency, start, end in (
            ("usd", date(2026, 1, 1), date(2026, 1, 2)),
            ("USD", date(2026, 1, 2), date(2026, 1, 1)),
        ):
            database = FakeDatabaseConnection()
            with self.subTest(currency=currency, start=start), self.assertRaises(ValueError):
                publish_company_payout_report(
                    database,
                    company_id=str(uuid7()),
                    seller_namespace="seller",
                    currency=currency,
                    start_date=start,
                    end_date=end,
                    preprocess_version="v0",
                    settlement_ids=[],
                    marketplace_names=[],
                    report_name="Report",
                    change_reason="Initial",
                )
            self.assertFalse(database.execute_calls)
