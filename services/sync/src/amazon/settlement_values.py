"""Exact parsing for Amazon Settlement V2 source values."""

import re
from contextlib import suppress
from datetime import UTC, date, datetime

from ..numeric import Numeric

_NUMBER_PATTERN = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")
_CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")
_OFFSET_TIMESTAMP_PATTERN = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]"
    r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"
    r"(?:[.,][0-9]+)?(?:Z| UTC|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
)
_UTC_DAY_FIRST_TIMESTAMP_PATTERN = re.compile(
    r"^[0-9]{2}\.[0-9]{2}\.[0-9]{4} "
    r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] UTC$"
)


def parse_settlement_amount(value: str) -> Numeric:
    """Parse a source amount exactly without accepting grouping separators."""
    normalized = value.strip()
    if not normalized or not _NUMBER_PATTERN.fullmatch(normalized):
        raise ValueError(f"Invalid Settlement V2 amount: {value!r}.")

    return Numeric(normalized.replace(",", "."))


def parse_settlement_timestamp(value: str) -> datetime:
    """Parse an observed Settlement V2 timestamp with a mandatory source zone."""
    normalized = value.strip()
    parsed: datetime | None = None
    if _OFFSET_TIMESTAMP_PATTERN.fullmatch(normalized):
        iso_candidate = normalized
        if iso_candidate.endswith(" UTC"):
            iso_candidate = f"{iso_candidate[:-4]}+00:00"
        elif iso_candidate.endswith("Z"):
            iso_candidate = f"{iso_candidate[:-1]}+00:00"
        with suppress(ValueError):
            parsed = datetime.fromisoformat(iso_candidate)
    elif _UTC_DAY_FIRST_TIMESTAMP_PATTERN.fullmatch(normalized):
        with suppress(ValueError):
            parsed = datetime.strptime(
                normalized,
                "%d.%m.%Y %H:%M:%S UTC",
            ).replace(tzinfo=UTC)

    if parsed is None or parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"Unsupported or timezone-free Settlement V2 timestamp: {value!r}.")
    return parsed


def parse_settlement_date(value: str) -> date:
    """Parse the unambiguous date formats observed in Settlement V2 reports."""
    normalized = value.strip()
    with suppress(ValueError):
        return date.fromisoformat(normalized)
    components = normalized.split(".")
    if len(components) == 3:
        with suppress(ValueError):
            return date(int(components[2]), int(components[1]), int(components[0]))
    raise ValueError(f"Unsupported Settlement V2 date: {value!r}.")


def parse_settlement_quantity(value: str | None) -> int | None:
    """Parse an optional integral quantity without truncation."""
    if value is None or not value.strip():
        return None
    quantity = parse_settlement_amount(value)
    if quantity.value != quantity.value.to_integral_value() or quantity < 0:
        raise ValueError(f"Settlement V2 quantity must be a non-negative integer: {value!r}.")
    parsed = int(quantity)
    if parsed > 9_223_372_036_854_775_807:
        raise ValueError(f"Settlement V2 quantity exceeds bigint: {value!r}.")
    return parsed


def parse_currency_code(value: str) -> str:
    """Require one uppercase ISO-style three-letter currency code."""
    currency = value.strip()
    if not _CURRENCY_PATTERN.fullmatch(currency):
        raise ValueError(f"Invalid Settlement V2 currency: {value!r}.")
    return currency


__all__ = [
    "parse_currency_code",
    "parse_settlement_amount",
    "parse_settlement_date",
    "parse_settlement_quantity",
    "parse_settlement_timestamp",
]
