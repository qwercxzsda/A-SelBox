"""Tests for advisory fee checks and the publication callback boundary."""

import unittest
from collections.abc import Generator
from contextlib import contextmanager
from datetime import date
from unittest.mock import patch
from uuid import UUID

from ....src.database import company_sku_fee_rates, fee_reference_checks
from ....src.database.company_sku_fee_rates import CompanySkuFeeRate, insert_company_sku_fee_rate
from ....src.database.fee_reference_checks import check_settlement_fee_references
from ....src.numeric import Numeric
from ...support.fakes import FakeDatabaseConnection

FEE_RATE_ID = str(UUID(int=1))
PROCESSING_LOG_ID = str(UUID(int=2))


class TestFeeReferenceChecks(unittest.TestCase):
    def test_rejects_invalid_or_combined_scopes_before_connecting(self) -> None:
        for scope in (
            {"processing_log_id": PROCESSING_LOG_ID, "fee_rate_id": FEE_RATE_ID},
            {"processing_log_id": "invalid"},
            {"fee_rate_id": "invalid"},
        ):
            with self.subTest(scope=scope):
                database = FakeDatabaseConnection()
                with self.assertRaises(ValueError):
                    check_settlement_fee_references(database, **scope)
                self.assertEqual(database.connection_count, 0)

    def test_empty_results_are_quiet_in_each_scope(self) -> None:
        for scope in ({}, {"processing_log_id": PROCESSING_LOG_ID}, {"fee_rate_id": FEE_RATE_ID}):
            with self.subTest(scope=scope):
                database = FakeDatabaseConnection()
                with self.assertNoLogs(fee_reference_checks.__name__, level="WARNING"):
                    self.assertEqual(check_settlement_fee_references(database, **scope), ())
                self.assertEqual(len(database.execute_calls), 1)
                parameters = database.execute_calls[0][1]
                for name, value in scope.items():
                    self.assertEqual(parameters[name], value)

    def test_database_failure_is_advisory_and_does_not_log_exception_details(self) -> None:
        database = FakeDatabaseConnection()
        with (
            patch.object(
                database.cursor_obj, "execute", side_effect=RuntimeError("sensitive DB detail")
            ),
            self.assertLogs(fee_reference_checks.__name__, level="ERROR") as logged,
        ):
            self.assertIsNone(
                check_settlement_fee_references(database, processing_log_id=PROCESSING_LOG_ID)
            )
        self.assertEqual(len(logged.records), 1)
        self.assertIn("RuntimeError", logged.output[0])
        self.assertNotIn("sensitive DB detail", logged.output[0])


class TestFeeRatePublication(unittest.TestCase):
    def setUp(self) -> None:
        self.fee_rate = CompanySkuFeeRate(
            id=FEE_RATE_ID,
            seller_namespace="seller-na",
            marketplace_id="ATVPDKIKX0DER",
            sku="SKU-1",
            company_id=str(UUID(int=3)),
            fee_rate_percent=Numeric("7.125"),
            valid_from=date(2026, 8, 1),
            valid_to=None,
        )

    def test_publishes_before_running_the_advisory_check(self) -> None:
        database = FakeDatabaseConnection()
        events: list[str] = []

        @contextmanager
        def transaction() -> Generator[None]:
            events.append("begin")
            yield
            events.append("commit")

        def record_check(*_args: object, **_kwargs: object) -> None:
            events.append("check")

        with (
            patch.object(database.connection_obj, "transaction", side_effect=transaction),
            patch.object(
                company_sku_fee_rates,
                "check_settlement_fee_references",
                side_effect=record_check,
            ) as check,
        ):
            self.assertEqual(insert_company_sku_fee_rate(database, self.fee_rate), FEE_RATE_ID)
        self.assertEqual(events, ["begin", "commit", "check"])
        check.assert_called_once_with(database, fee_rate_id=FEE_RATE_ID)
        self.assertEqual(len(database.execute_calls), 1)
        self.assertEqual(database.execute_calls[0][1]["fee_rate_percent"], Numeric("7.125"))

    def test_failed_commit_does_not_run_the_advisory_check(self) -> None:
        database = FakeDatabaseConnection()

        @contextmanager
        def failed_commit() -> Generator[None]:
            yield
            raise RuntimeError("commit failed")

        with (
            patch.object(database.connection_obj, "transaction", side_effect=failed_commit),
            patch.object(company_sku_fee_rates, "check_settlement_fee_references") as check,
            self.assertRaisesRegex(RuntimeError, "commit failed"),
        ):
            insert_company_sku_fee_rate(database, self.fee_rate)
        check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
