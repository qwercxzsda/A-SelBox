"""Exact immutable company/month reads and database-derived source selection."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import cast
from unittest.mock import patch
from uuid import uuid7

from psycopg.types.json import Jsonb

from ....src.database.payout_reports import (
    load_company_payout_report,
    load_company_payout_report_records,
    publish_company_payout_report,
)
from ...support.fakes import FakeDatabaseConnection


class TestPayoutReports(unittest.TestCase):
    def test_publication_sends_scope_and_accepts_the_saved_report_id(self) -> None:
        requested_id, saved_id = uuid7(), uuid7()
        company_id = str(uuid7())
        database = FakeDatabaseConnection([(saved_id,)])
        with patch("services.sync.src.database.payout_reports.uuid7", return_value=requested_id):
            result = publish_company_payout_report(
                database,
                company_id=company_id,
                marketplace_name="Amazon.com",
                currency="USD",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 31),
                report_name="January report",
                change_reason="Initial saved report",
            )
        self.assertEqual(result, str(saved_id))
        self.assertEqual(database.connection_obj.transaction_count, 1)
        statement, parameters = database.execute_calls[0]
        self.assertIn("private.publish_company_payout_report", statement)
        payload = cast(dict[str, object], cast(Jsonb, parameters["payload"]).obj)
        self.assertEqual(
            payload,
            {
                "id": str(requested_id),
                "company_id": company_id,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-01-01",
                "end_date": "2026-01-31",
                "dataset_key": "economics",
                "report_name": "January report",
                "change_reason": "Initial saved report",
            },
        )

    def test_empty_monthly_aggregate_does_not_fabricate_currency(self) -> None:
        saved_id = uuid7()
        database = FakeDatabaseConnection([(saved_id,)])
        result = publish_company_payout_report(
            database,
            company_id=str(uuid7()),
            marketplace_name=None,
            currency=None,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            report_name="January report",
            change_reason="Empty reporting month",
        )
        self.assertEqual(result, str(saved_id))
        payload = cast(dict[str, object], cast(Jsonb, database.execute_calls[0][1]["payload"]).obj)
        self.assertIsNone(payload["currency"])

    def test_saved_header_retains_exact_totals_and_marketplace(self) -> None:
        report_id, company_id = str(uuid7()), str(uuid7())
        header = (
            report_id,
            company_id,
            "JPY",
            date(2026, 1, 1),
            date(2026, 1, 31),
            "economics",
            "Amazon.co.jp",
            "January",
            "Initial",
            4,
            3,
            31,
            2,
            Decimal("1e1000"),
            Decimal("-0.123456789123456789"),
            Decimal("1e1000"),
            datetime(2026, 4, 1, tzinfo=UTC),
        )
        database = FakeDatabaseConnection([header])
        report = load_company_payout_report(database, report_id)
        if report is None:
            self.fail("Expected saved report.")
        self.assertEqual(report.source_amount, Decimal("1e1000"))
        self.assertEqual(report.fee_amount, Decimal("-0.123456789123456789"))
        self.assertEqual(report.marketplace_name, "Amazon.co.jp")
        self.assertEqual(
            (
                report.component_count,
                report.finances_version_count,
                report.data_kiosk_version_count,
                report.terms_version_count,
            ),
            (4, 3, 31, 2),
        )
        self.assertNotIn("current_", database.execute_calls[0][0])
        self.assertNotIn("source_coverage", database.execute_calls[0][0])
        self.assertIn("finances_version_count", database.execute_calls[0][0])
        self.assertIn("data_kiosk_version_count", database.execute_calls[0][0])

    def test_currencyless_header_must_be_an_empty_aggregate(self) -> None:
        report_id, company_id = str(uuid7()), str(uuid7())
        header = (
            report_id,
            company_id,
            None,
            date(2026, 6, 1),
            date(2026, 6, 30),
            "economics",
            None,
            "June empty report",
            "Explicit request",
            0,
            0,
            0,
            0,
            Decimal(0),
            Decimal(0),
            Decimal(0),
            datetime(2026, 7, 1, tzinfo=UTC),
        )
        report = load_company_payout_report(FakeDatabaseConnection([header]), report_id)
        if report is None:
            self.fail("Expected saved empty report.")
        self.assertIsNone(report.currency)
        self.assertIsNone(report.marketplace_name)
        self.assertEqual(
            (report.source_amount, report.fee_amount, report.company_amount),
            (Decimal(0), Decimal(0), Decimal(0)),
        )
        for index, value in (
            (9, 1),
            (13, Decimal(1)),
            (14, Decimal(-1)),
            (15, Decimal(1)),
        ):
            invalid = (*header[:index], value, *header[index + 1 :])
            with (
                self.subTest(index=index),
                self.assertRaisesRegex(RuntimeError, "without a currency"),
            ):
                load_company_payout_report(FakeDatabaseConnection([invalid]), report_id)

    def test_derived_records_preserve_terms_and_stable_source_identity(self) -> None:
        report, source_row, version, identity, sku, terms = (str(uuid7()) for _ in range(6))
        amount = Decimal("-5.123456789123456789")
        for authoritative, component_type, fee_base, status in (
            (True, "FbaStorageFee", None, "NOT_APPLICABLE"),
            (False, "NET_PRODUCT_SALES", amount, "MISSING_FEE"),
        ):
            with self.subTest(authoritative=authoritative):
                record = (
                    report,
                    "DATA_KIOSK",
                    authoritative,
                    source_row,
                    version,
                    identity,
                    sku,
                    terms,
                    None,
                    " SKU ",
                    "Amazon.com",
                    date(2026, 1, 1),
                    component_type,
                    "USD",
                    amount,
                    None,
                    fee_base,
                    None,
                    Decimal(0) if authoritative else None,
                    amount if authoritative else None,
                    status,
                )
                database = FakeDatabaseConnection(fetchall_results=[[record]])
                result = load_company_payout_report_records(database, report)[0]
                self.assertEqual(result.terms_version_id, terms)
                self.assertIsNone(result.fee_period_id)
                self.assertEqual(result.fee_base, fee_base)
                self.assertEqual(result.sku, " SKU ")
                self.assertEqual(result.source_amount, amount)
                self.assertEqual(result.company_amount, amount if authoritative else None)
                self.assertEqual(result.authoritative, authoritative)
                self.assertEqual(result.currency, "USD")
                self.assertEqual(result.identity, (report, "DATA_KIOSK", source_row))
                self.assertIn("private.read_payout_report_records", database.execute_calls[0][0])

    def test_missing_report_is_not_synthesized(self) -> None:
        self.assertIsNone(load_company_payout_report(FakeDatabaseConnection([None]), str(uuid7())))

    def test_invalid_scope_fails_before_publication(self) -> None:
        for currency, start, end, dataset in (
            ("usd", date(2026, 1, 1), date(2026, 1, 31), "economics"),
            ("USD", date(2026, 1, 31), date(2026, 1, 1), "economics"),
            ("USD", date(2026, 1, 1), date(2026, 1, 30), "economics"),
            ("USD", date(2026, 1, 1), date(2026, 1, 31), "inventory"),
        ):
            database = FakeDatabaseConnection()
            with self.subTest(currency=currency, start=start), self.assertRaises(ValueError):
                publish_company_payout_report(
                    database,
                    company_id=str(uuid7()),
                    marketplace_name="Amazon.com",
                    currency=currency,
                    start_date=start,
                    end_date=end,
                    dataset_key=dataset,
                    report_name="Report",
                    change_reason="Initial",
                )
            self.assertFalse(database.execute_calls)
