"""Behavior tests for the single Python precision boundary."""

import unittest
from decimal import Decimal, Inexact, Rounded, localcontext

from ...src.numeric import NUMERIC_PRECISION_BOUND, ZERO, Numeric, NumericBoundError


class TestNumeric(unittest.TestCase):
    def test_construction_preserves_decimal_digits_and_scale(self) -> None:
        value = Decimal("123456789012345678901234567890.123400")

        with localcontext() as context:
            context.prec = 2
            number = Numeric(value)

        self.assertEqual(number.value.as_tuple(), value.as_tuple())
        self.assertEqual(str(number), str(value))
        self.assertEqual(Numeric(number), number)

    def test_construction_checks_coefficient_and_exponent_precision(self) -> None:
        bound = NUMERIC_PRECISION_BOUND
        for value in ("9" * bound, f"1E{bound - 1}", f"1E-{bound}"):
            with self.subTest(value=value):
                self.assertEqual(Numeric(value).value, Decimal(value))
        for value in ("9" * (bound + 1), f"1E{bound}", f"1E-{bound + 1}"):
            with self.subTest(value=value), self.assertRaises(NumericBoundError):
                Numeric(value)

    def test_construction_rejects_non_finite_values(self) -> None:
        for value in ("NaN", "sNaN", "Infinity", "-Infinity"):
            with self.subTest(value=value), self.assertRaises(NumericBoundError):
                Numeric(value)

    def test_arithmetic_is_exact_under_a_rounding_trapping_context(self) -> None:
        left = Numeric("12345678901234567890.12345")
        right = Numeric("0.000000000000000000001")
        with localcontext() as context:
            context.prec = 2
            context.traps[Inexact] = True
            context.traps[Rounded] = True
            self.assertEqual(left + right, Numeric("12345678901234567890.123450000000000000001"))
            self.assertEqual(left - right, Numeric("12345678901234567890.123449999999999999999"))
            self.assertEqual(left * Numeric("7.125"), Numeric("87962962171296296217.12958125"))
            self.assertEqual(sum((left, right), ZERO), left + right)
            self.assertEqual(abs(-left), left)

    def test_each_arithmetic_result_is_checked_during_construction(self) -> None:
        maximum = Numeric("9" * NUMERIC_PRECISION_BOUND)
        smallest = Numeric(f"1E-{NUMERIC_PRECISION_BOUND}")
        operations = (
            lambda: maximum + 1,
            lambda: -maximum - 1,
            lambda: maximum * 10,
            lambda: smallest * Numeric("0.1"),
            lambda: Numeric(f"0E-{NUMERIC_PRECISION_BOUND}") * Numeric("0.1"),
            lambda: maximum + smallest,
        )
        for operation in operations:
            with self.subTest(operation=operation), self.assertRaises(NumericBoundError):
                operation()
        self.assertEqual(maximum - maximum, ZERO)
        self.assertEqual(smallest * ZERO, ZERO)

    def test_zero_results_preserve_their_exact_decimal_scale(self) -> None:
        self.assertEqual(
            (Numeric("1.000") - Numeric(1)).value.as_tuple(), Decimal("0.000").as_tuple()
        )
        self.assertEqual(
            (Numeric("0.000") * Numeric("0.1")).value.as_tuple(), Decimal("0.0000").as_tuple()
        )

    def test_numeric_has_numeric_comparison_semantics(self) -> None:
        number = Numeric("1.00")
        self.assertEqual(number, Numeric(1))
        self.assertEqual(hash(number), hash(Decimal(1)))
        self.assertLess(Numeric("0.9"), number)
        self.assertFalse(ZERO)
        self.assertEqual(int(Numeric("123.00")), 123)


if __name__ == "__main__":
    unittest.main()
