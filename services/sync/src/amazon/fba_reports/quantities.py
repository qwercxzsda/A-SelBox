"""Parse optional FBA unit quantities without inventing a missing zero."""

from ...numeric import Numeric
from .tabular import numeric_token


def optional_nonnegative_quantity(
    value: str,
    field_name: str,
    *,
    report_name: str,
) -> Numeric | None:
    if not value.strip():
        return None
    parsed = numeric_token(value, field_name, report_name=report_name)
    if parsed.value != parsed.value.to_integral_value() or parsed < 0:
        raise ValueError(f"{report_name} {field_name} must be a non-negative integer.")
    return parsed
