"""Validation for values crossing database and command boundaries."""

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from ..numeric import Numeric


def required_text(value: object, field_name: str) -> str:
    """Return trimmed non-empty text."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be non-empty text.")
    return value.strip()


def date_value(value: object, field_name: str) -> date:
    """Require a date without accepting ``datetime`` as its subclass."""
    if not isinstance(value, date) or isinstance(value, datetime):
        raise RuntimeError(f"{field_name} must be a date.")
    return value


def aware_datetime_value(value: object, field_name: str) -> datetime:
    """Require a timezone-aware database timestamp."""
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise RuntimeError(f"{field_name} must be a timezone-aware timestamp.")
    return value


def numeric_value(value: object, field_name: str) -> Numeric:
    """Construct a Numeric from an exact Decimal returned by the database."""
    if not isinstance(value, Decimal):
        raise RuntimeError(f"{field_name} must be a Decimal.")
    return Numeric(value)


def numeric_parameters(parameters: Mapping[str, object]) -> dict[str, object]:
    """Unwrap Numeric values only when binding PostgreSQL parameters."""
    return {
        key: value.value if isinstance(value, Numeric) else value
        for key, value in parameters.items()
    }


def non_negative_int_value(value: object, field_name: str) -> int:
    """Require a non-negative integer without accepting booleans."""
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise RuntimeError(f"{field_name} must be a non-negative integer.")
    return value


def normalize_uuid(value: object, field_name: str) -> str:
    """Return one UUID in canonical lowercase text form."""
    if not isinstance(value, (str, UUID)):
        raise TypeError(f"{field_name} must be a UUID.")
    uuid_text = value.strip() if isinstance(value, str) else str(value)
    try:
        return str(UUID(uuid_text))
    except ValueError:
        raise ValueError(f"{field_name} must be a UUID.") from None


__all__ = [
    "aware_datetime_value",
    "date_value",
    "non_negative_int_value",
    "normalize_uuid",
    "numeric_parameters",
    "numeric_value",
    "required_text",
]
