"""Tests for shared fail-closed database value validation."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from ....src.database.values import (
    aware_datetime_value,
    date_value,
    non_negative_int_value,
    normalize_uuid,
    numeric_value,
)
from ....src.numeric import NUMERIC_PRECISION_BOUND, NumericBoundError


class TestDatabaseValues(unittest.TestCase):
    def test_accepts_exact_database_driver_types(self) -> None:
        expected_date = date(2026, 8, 29)
        expected_timestamp = datetime(2026, 8, 29, 1, tzinfo=UTC)
        expected_decimal = Decimal("1.2500")

        self.assertIs(date_value(expected_date, "activity_date"), expected_date)
        self.assertIs(
            aware_datetime_value(expected_timestamp, "fetched_at"),
            expected_timestamp,
        )
        self.assertIs(numeric_value(expected_decimal, "amount").value, expected_decimal)
        self.assertEqual(non_negative_int_value(0, "row_count"), 0)

    def test_database_decimals_cross_the_general_numeric_bound_on_construction(self) -> None:
        for value in (Decimal(f"1E-{NUMERIC_PRECISION_BOUND + 1}"), Decimal("NaN")):
            with self.subTest(value=value), self.assertRaises(NumericBoundError):
                numeric_value(value, "fee_rate_percent")

    def test_normalizes_uuid_objects_and_text(self) -> None:
        expected = "00000000-0000-0000-0000-000000000001"
        self.assertEqual(normalize_uuid(UUID(int=1), "claim_token"), expected)
        self.assertEqual(normalize_uuid(f" {expected.upper()} ", "claim_token"), expected)

    def test_rejects_non_uuid_values(self) -> None:
        for value in (None, 1, "not-a-uuid"):
            with self.subTest(value=value), self.assertRaises((TypeError, ValueError)):
                normalize_uuid(value, "claim_token")

    def test_rejects_coercible_or_ambiguous_values(self) -> None:
        invalid_values = (
            (lambda: date_value(datetime(2026, 8, 29, tzinfo=UTC), "activity_date")),
            (
                lambda: aware_datetime_value(
                    datetime(2026, 8, 29),  # noqa: DTZ001 - deliberately invalid DB value.
                    "fetched_at",
                )
            ),
            (lambda: numeric_value("1.25", "amount")),
            (lambda: non_negative_int_value(True, "row_count")),
            (lambda: non_negative_int_value(-1, "row_count")),
        )

        for parse_invalid_value in invalid_values:
            with self.subTest(parser=parse_invalid_value), self.assertRaises(RuntimeError):
                parse_invalid_value()


if __name__ == "__main__":
    unittest.main()
