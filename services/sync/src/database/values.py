"""Validation for values crossing database and command boundaries."""

from datetime import date, datetime
from uuid import UUID


def required_text(value: object, field_name: str) -> str:
    """Return trimmed non-empty text."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be non-empty text.")
    return value.strip()


def required_date(value: object, field_name: str) -> date:
    """Require a date without accepting ``datetime`` as its subclass."""
    if not isinstance(value, date) or isinstance(value, datetime):
        raise RuntimeError(f"{field_name} must be a date.")
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
    "normalize_uuid",
    "required_date",
    "required_text",
]
