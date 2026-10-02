"""Exact immutable company/month reads and database-derived source selection."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import cast
from unittest.mock import patch
from uuid import uuid7

from psycopg.types.json import Jsonb

from ....src.database.payout_reports import (
    load_company_payout_reconciliation,
    load_company_payout_report,
    load_company_payout_report_components,
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
                "currency": "USD",
                "start_date": "2026-01-01",
                "end_date": "2026-01-31",
                "dataset_key": "economics",
                "report_name": "January report",
                "change_reason": "Initial saved report",
            },
        )

    def test_empty_company_publication_does_not_fabricate_currency(self) -> None:
        saved_id = uuid7()
        database = FakeDatabaseConnection([(saved_id,)])
        result = publish_company_payout_report(
            database,
            company_id=str(uuid7()),
            currency=None,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            report_name="January report",
            change_reason="Empty company",
        )
        self.assertEqual(result, str(saved_id))
        payload = cast(dict[str, object], cast(Jsonb, database.execute_calls[0][1]["payload"]).obj)
        self.assertIsNone(payload["currency"])

    def test_saved_header_retains_exact_totals_and_declared_marketplaces(self) -> None:
        report_id, company_id = str(uuid7()), str(uuid7())
        header = (
            report_id,
            company_id,
            "JPY",
            date(2026, 1, 1),
            date(2026, 1, 31),
            "economics",
            ["Amazon.co.jp"],
            "January",
            "Initial",
            "v1",
            1,
            1,
            1,
            2,
            1,
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
        self.assertEqual(report.marketplace_names, ("Amazon.co.jp",))
        self.assertNotIn("current_", database.execute_calls[0][0])
        self.assertEqual(report.calculation_version, "v1")
        unsupported = (*header[:9], "v0", *header[10:])
        with self.assertRaisesRegex(RuntimeError, "Unsupported payout calculation version"):
            load_company_payout_report(FakeDatabaseConnection([unsupported]), report_id)

    def test_currencyless_header_must_be_an_empty_aggregate(self) -> None:
        report_id, company_id = str(uuid7()), str(uuid7())
        marketplace_names: list[str] = []
        header = (
            report_id,
            company_id,
            None,
            date(2026, 6, 1),
            date(2026, 6, 30),
            "economics",
            marketplace_names,
            "June empty report",
            "Explicit request",
            "v1",
            0,
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
        self.assertEqual(
            (report.source_amount, report.fee_amount, report.company_amount),
            (Decimal(0), Decimal(0), Decimal(0)),
        )
        for index, value in (
            (6, ["Amazon.com"]),
            (10, 1),
            (11, 1),
            (15, Decimal(1)),
            (16, Decimal(-1)),
            (17, Decimal(1)),
        ):
            invalid = (*header[:index], value, *header[index + 1 :])
            with (
                self.subTest(index=index),
                self.assertRaisesRegex(RuntimeError, "without a currency"),
            ):
                load_company_payout_report(FakeDatabaseConnection([invalid]), report_id)

    def test_components_preserve_terms_for_costs_and_supporting_sales(self) -> None:
        ids = [str(uuid7()) for _ in range(7)]
        amount = Decimal("-5.123456789123456789")
        for authoritative, component_type, fee_base, status in (
            (True, "FbaStorageFee", None, "NOT_APPLICABLE"),
            (False, "NET_PRODUCT_SALES", amount, "MISSING_FEE"),
        ):
            with self.subTest(authoritative=authoritative):
                component = (
                    ids[0],
                    ids[1],
                    1,
                    "DATA_KIOSK",
                    authoritative,
                    ids[2],
                    ids[3],
                    ids[4],
                    ids[5],
                    ids[6],
                    None,
                    " SKU ",
                    "Amazon.com",
                    date(2026, 1, 1),
                    component_type,
                    amount,
                    None,
                    fee_base,
                    None,
                    Decimal(0) if authoritative else None,
                    amount if authoritative else None,
                    status,
                )
                database = FakeDatabaseConnection(fetchall_results=[[component]])
                result = load_company_payout_report_components(database, ids[1])[0]
                self.assertEqual(result.terms_version_id, ids[6])
                self.assertIsNone(result.fee_period_id)
                self.assertEqual(result.fee_base, fee_base)
                self.assertEqual(result.sku, " SKU ")
                self.assertEqual(result.source_amount, amount)
                self.assertEqual(result.company_amount, amount if authoritative else None)
                self.assertEqual(result.authoritative, authoritative)

    def test_reconciliation_reader_preserves_exact_seller_control_amounts(self) -> None:
        report = str(uuid7())
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        report,
                        1,
                        "seller",
                        date(2026, 1, 1),
                        None,
                        "USD",
                        Decimal(100),
                        Decimal(-3),
                        Decimal(-12),
                        Decimal(-10),
                        Decimal(-2),
                        Decimal(85),
                        Decimal(85),
                    )
                ]
            ]
        )
        result = load_company_payout_reconciliation(database, report)[0]
        self.assertIsNone(result.marketplace_name)
        self.assertEqual(result.settlement_category_amount, Decimal(100))
        self.assertEqual(result.selbox_category_amount, Decimal(-3))
        self.assertEqual(result.data_kiosk_settlement_control, Decimal(-12))
        self.assertEqual(result.data_kiosk_category_amount, Decimal(-10))
        self.assertEqual(result.difference, Decimal(-2))
        self.assertEqual(result.accounted_total, result.settlement_total)
        self.assertIn("public.payout_report_reconciliation", database.execute_calls[0][0])

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
                    currency=currency,
                    start_date=start,
                    end_date=end,
                    dataset_key=dataset,
                    report_name="Report",
                    change_reason="Initial",
                )
            self.assertFalse(database.execute_calls)
