"""Bounded decimal values with arithmetic independent of the Decimal context.

The precision bound counts all fixed-point digits, including zeros implied by
the exponent. Thus ``1E999`` and ``1E-1000`` fit, while ``1E1000`` does not.
Trailing fractional zeros count because they are part of the inner Decimal.
PostgreSQL separately enforces its much smaller fee-rate precision bound.
"""

from dataclasses import dataclass
from decimal import Decimal
from functools import total_ordering

NUMERIC_PRECISION_BOUND = 1000


class NumericBoundError(ValueError):
    """A Numeric cannot represent a non-finite or over-precision Decimal."""


@total_ordering
@dataclass(frozen=True, slots=True, init=False, eq=False)
class Numeric:
    """An immutable Decimal checked once on construction, including results."""

    value: Decimal

    def __init__(self, value: object = 0) -> None:
        if isinstance(value, Numeric):
            value = value.value
        if not isinstance(value, Decimal | str | int) or isinstance(value, bool):
            raise TypeError("Numeric requires a Decimal, decimal string, or integer.")
        decimal = Decimal(value)
        _, digits, exponent = decimal.as_tuple()
        if not isinstance(exponent, int):
            raise NumericBoundError("Numeric values must be finite.")
        precision = max(len(digits) + max(exponent, 0), -exponent)
        if precision > NUMERIC_PRECISION_BOUND:
            raise NumericBoundError(
                f"Numeric precision exceeds {NUMERIC_PRECISION_BOUND} fixed-point digits."
            )
        object.__setattr__(self, "value", decimal)

    def __add__(self, other: object) -> Numeric:
        if not isinstance(other, Numeric | int) or isinstance(other, bool):
            return NotImplemented
        right = other if isinstance(other, Numeric) else Numeric(other)
        left_coefficient, left_exponent = _components(self.value)
        right_coefficient, right_exponent = _components(right.value)
        exponent = min(left_exponent, right_exponent)
        coefficient = left_coefficient * 10 ** (left_exponent - exponent)
        coefficient += right_coefficient * 10 ** (right_exponent - exponent)
        return Numeric(_decimal_from_components(coefficient, exponent))

    def __radd__(self, other: int) -> Numeric:
        return self + other

    def __sub__(self, other: object) -> Numeric:
        if not isinstance(other, Numeric | int) or isinstance(other, bool):
            return NotImplemented
        return self + -Numeric(other)

    def __rsub__(self, other: object) -> Numeric:
        if not isinstance(other, Numeric | int) or isinstance(other, bool):
            return NotImplemented
        return Numeric(other) - self

    def __mul__(self, other: object) -> Numeric:
        if not isinstance(other, Numeric | int) or isinstance(other, bool):
            return NotImplemented
        left_coefficient, left_exponent = _components(self.value)
        right = other if isinstance(other, Numeric) else Numeric(other)
        right_coefficient, right_exponent = _components(right.value)
        return Numeric(
            _decimal_from_components(
                left_coefficient * right_coefficient, left_exponent + right_exponent
            )
        )

    def __rmul__(self, other: int) -> Numeric:
        return self * other

    def __neg__(self) -> Numeric:
        return Numeric(self.value.copy_negate())

    def __abs__(self) -> Numeric:
        return Numeric(self.value.copy_abs())

    def __bool__(self) -> bool:
        return bool(self.value)

    def __int__(self) -> int:
        return int(self.value)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Numeric):
            return self.value == other.value
        if isinstance(other, Decimal | int):
            return self.value == other
        return NotImplemented

    def __lt__(self, other: object) -> bool:
        if isinstance(other, Numeric):
            return self.value < other.value
        if isinstance(other, Decimal | int):
            return self.value < other
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self.value)

    def __str__(self) -> str:
        return str(self.value)

    def __repr__(self) -> str:
        return f"Numeric({str(self.value)!r})"


def _components(value: Decimal) -> tuple[int, int]:
    sign, digits, exponent = value.as_tuple()
    # Every caller supplies an already-constructed, finite Numeric value.
    coefficient = 0
    for digit in digits:
        coefficient = coefficient * 10 + digit
    return (-coefficient if sign else coefficient), int(exponent)


def _decimal_from_components(coefficient: int, exponent: int) -> Decimal:
    sign, digits, _ = Decimal(coefficient).as_tuple()
    return Decimal((sign, digits, exponent))


ZERO = Numeric(0)

__all__ = ["NUMERIC_PRECISION_BOUND", "ZERO", "Numeric", "NumericBoundError"]
