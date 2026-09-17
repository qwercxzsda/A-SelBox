"""Tests for exact Amazon Settlement values."""

import unittest

from ....src.amazon.settlement_values import (
    parse_settlement_amount,
    parse_settlement_quantity,
    parse_settlement_timestamp,
)
from ....src.numeric import NUMERIC_PRECISION_BOUND, Numeric, NumericBoundError


class TestSettlementValues(unittest.TestCase):
    def test_timestamp_parser_accepts_only_supported_source_formats(self) -> None:
        accepted = (
            "2026-08-02T00:30:00+09:00",
            "2026-08-02 00:30:00.123Z",
            "2026-08-02 00:30:00,123 UTC",
            "02.08.2026 00:30:00 UTC",
        )
        rejected = (
            "2026-08-02T00:30+09:00",
            "20260802T003000+0900",
            "2026-W31-7T00:30:00+09:00",
            "2026-08-02T00:30:00",
        )

        for value in accepted:
            with self.subTest(value=value):
                self.assertIsNotNone(parse_settlement_timestamp(value).utcoffset())
        for value in rejected:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_settlement_timestamp(value)

    def test_amount_parser_accepts_dot_or_comma_decimal_without_rounding(self) -> None:
        dot_amount = parse_settlement_amount("10.2500000000000000001")
        comma_amount = parse_settlement_amount("-10,2500000000000000001")

        self.assertEqual(dot_amount, Numeric("10.2500000000000000001"))
        self.assertEqual(comma_amount, Numeric("-10.2500000000000000001"))
        self.assertEqual(
            dot_amount.value.as_tuple(), Numeric("10.2500000000000000001").value.as_tuple()
        )

    def test_amount_parser_rejects_ambiguous_or_non_decimal_values(self) -> None:
        for raw_value in ("1,234.56", "NaN", "1 000.00", ""):
            with self.subTest(raw_value=raw_value), self.assertRaises(ValueError):
                parse_settlement_amount(raw_value)

    def test_amount_parser_preserves_digits_within_numeric_bound(self) -> None:
        amount = "123456789012345678901234567890123456789.123456789012345678901"

        self.assertEqual(parse_settlement_amount(amount), Numeric(amount))

    def test_amount_parser_enforces_the_numeric_construction_bound(self) -> None:
        with self.assertRaises(NumericBoundError):
            parse_settlement_amount("9" * (NUMERIC_PRECISION_BOUND + 1))

    def test_quantity_parser_accepts_the_full_nonnegative_bigint_range(self) -> None:
        for quantity in (0, 2_147_483_648, 9_223_372_036_854_775_807):
            with self.subTest(quantity=quantity):
                self.assertEqual(parse_settlement_quantity(str(quantity)), quantity)
        for value in ("9223372036854775808", "-1", "1.5"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_settlement_quantity(value)


if __name__ == "__main__":
    unittest.main()
