"""Ownership identity and complete fee publication boundary checks."""

import unittest
from datetime import UTC, date, datetime
from decimal import localcontext
from typing import cast
from unittest.mock import patch
from uuid import UUID, uuid7

from psycopg.types.json import Jsonb

from ....src.database.company_terms import FeePeriod, publish_sku_terms
from ....src.numeric import Numeric
from ...support.fakes import FakeDatabaseConnection


class TestFeePeriods(unittest.TestCase):
    def test_exact_percentages_enforce_fractional_precision_including_zeros(self) -> None:
        for value in ("1.0000000", "0.0000001", "100.000001", "-0.1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric(value))
        with localcontext() as context:
            context.prec = 2
            period = FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric("12.123456"))
        self.assertEqual(str(period.fee_rate_percent), "12.123456")

    def test_rejects_empty_ranges_and_timestamps(self) -> None:
        with self.assertRaises(ValueError):
            FeePeriod("Amazon.com", date(2026, 1, 1), date(2026, 1, 1), Numeric(5))
        with self.assertRaises(RuntimeError):
            FeePeriod("Amazon.com", datetime(2026, 1, 1, tzinfo=UTC), None, Numeric(5))


class TestFeePublication(unittest.TestCase):
    def test_complete_publication_preserves_exact_values_and_expected_version(self) -> None:
        version_id = uuid7()
        expected_id = str(uuid7())
        database = FakeDatabaseConnection([(version_id,)])
        with patch("services.sync.src.database.company_terms.uuid7", return_value=version_id):
            result = publish_sku_terms(
                database,
                sku=" SKU ",
                company_id=str(uuid7()),
                expected_current_version_id=expected_id,
                periods=[
                    FeePeriod("Amazon.com", date(2026, 7, 1), None, Numeric("7.123456")),
                    FeePeriod(
                        "Amazon.com", date(2026, 1, 1), date(2026, 7, 1), Numeric("5.000000")
                    ),
                ],
                change_reason="Correct annual terms",
            )
        self.assertEqual(result, str(version_id))
        self.assertEqual(database.connection_obj.transaction_count, 1)
        self.assertEqual(len(database.execute_calls), 1)
        payload = cast(dict[str, object], cast(Jsonb, database.execute_calls[0][1]["payload"]).obj)
        self.assertEqual(payload["expected_current_version_id"], expected_id)
        self.assertEqual(payload["sku"], " SKU ")
        self.assertNotIn("seller_namespace", payload)
        periods = cast(list[dict[str, object]], payload["periods"])
        self.assertEqual([item["fee_rate_percent"] for item in periods], ["5.000000", "7.123456"])
        self.assertEqual(periods[0]["valid_to"], "2026-07-01")

    def test_empty_replacement_withdraws_all_coverage(self) -> None:
        version_id = uuid7()
        database = FakeDatabaseConnection([(version_id,)])
        with patch("services.sync.src.database.company_terms.uuid7", return_value=version_id):
            publish_sku_terms(
                database,
                sku="SKU",
                company_id=None,
                expected_current_version_id=None,
                periods=[],
                change_reason="Withdraw coverage",
            )
        payload = cast(dict[str, object], cast(Jsonb, database.execute_calls[0][1]["payload"]).obj)
        self.assertEqual(payload["periods"], [])

    def test_overlap_fails_before_writing(self) -> None:
        database = FakeDatabaseConnection()
        with self.assertRaisesRegex(ValueError, "overlap"):
            publish_sku_terms(
                database,
                sku=" SKU ",
                company_id=str(uuid7()),
                expected_current_version_id=None,
                periods=[
                    FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric(5)),
                    FeePeriod("Amazon.com", date(2026, 7, 1), None, Numeric(7)),
                ],
                change_reason="Invalid replacement",
            )
        self.assertFalse(database.execute_calls)

    def test_same_dates_in_different_marketplaces_do_not_overlap(self) -> None:
        version_id = uuid7()
        database = FakeDatabaseConnection([(version_id,)])
        with patch("services.sync.src.database.company_terms.uuid7", return_value=version_id):
            publish_sku_terms(
                database,
                sku=" SKU ",
                company_id=None,
                expected_current_version_id=None,
                change_reason="Unassign with retained terms",
                periods=[
                    FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric(0)),
                    FeePeriod("Amazon.ca", date(2026, 1, 1), None, Numeric(7)),
                ],
            )
        payload = cast(dict[str, object], cast(Jsonb, database.execute_calls[0][1]["payload"]).obj)
        self.assertEqual(payload["sku"], " SKU ")
        self.assertIsNone(payload["company_id"])
        self.assertEqual(UUID(str(payload["sku_id"])).version, 7)


if __name__ == "__main__":
    unittest.main()
