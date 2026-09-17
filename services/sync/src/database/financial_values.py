"""Validate exact computed amounts without imposing source-amount precision limits."""

import re
from decimal import Decimal


def financial_amount(value: object, name: str) -> Decimal:
    """Preserve the database's exact aggregate or product precision."""
    if not isinstance(value, Decimal) or not value.is_finite():
        raise RuntimeError(f"{name} must be a finite Decimal.")
    return value


def optional_financial_amount(value: object, name: str) -> Decimal | None:
    """Keep missing amounts distinct from exact zero."""
    return None if value is None else financial_amount(value, name)


def financial_currency(value: object) -> str:
    """Require the stored three-uppercase-letter currency convention."""
    if not isinstance(value, str) or re.fullmatch(r"[A-Z]{3}", value) is None:
        raise ValueError("currency must contain exactly three uppercase letters.")
    return value


def nonnegative_count(value: object, name: str) -> int:
    """Reject missing, boolean, fractional, and negative inventories."""
    if type(value) is not int or value < 0:
        raise RuntimeError(f"{name} must be a nonnegative integer.")
    return value
