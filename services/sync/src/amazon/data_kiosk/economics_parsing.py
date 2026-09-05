"""Typed, value-redacting parsers for Data Kiosk Economics document rows."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Never, cast

from ...numeric import Numeric
from .errors import DataKioskEconomicsNormalizationError
from .models import ParsedJsonlDocument, ParsedJsonlRow


@dataclass(frozen=True)
class EconomicsRowContext:
    """Validated native identity shared by every observation in one row."""

    start_date: date
    end_date: date
    marketplace_id: str
    amz_sku: str
    source_line_number: int
    document_sha256: str
    source_document_id: str


def parse_row_context(
    document: ParsedJsonlDocument,
    parsed_row: ParsedJsonlRow,
    source_document_id: str,
) -> EconomicsRowContext:
    """Validate the DAY/MSKU fields without echoing their source values."""
    row = parsed_row.value
    line_number = parsed_row.source_line_number
    start_date = _required_date(row, "startDate", line_number)
    end_date = _required_date(row, "endDate", line_number)
    if start_date > end_date:
        raise_invalid(line_number, "startDate/endDate")
    return EconomicsRowContext(
        start_date=start_date,
        end_date=end_date,
        marketplace_id=_required_canonical_string(row, "marketplaceId", line_number),
        amz_sku=_required_canonical_string(row, "msku", line_number),
        source_line_number=line_number,
        document_sha256=document.decoded_sha256,
        source_document_id=source_document_id,
    )


def object_value(value: object, line_number: int, path: str) -> Mapping[str, object]:
    """Narrow a JSON value to an object with string keys."""
    if not isinstance(value, Mapping):
        raise_invalid(line_number, path)
    object_mapping = cast(Mapping[object, object], value)
    if not all(isinstance(key, str) for key in object_mapping):
        raise_invalid(line_number, path)
    return cast(Mapping[str, object], object_mapping)


def optional_array(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
) -> Sequence[object]:
    """Read a nullable GraphQL list as an empty or typed sequence."""
    value = owner.get(key)
    if value is None:
        return ()
    return required_array(owner, key, line_number)


def required_array(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
) -> Sequence[object]:
    """Read a required GraphQL list without treating null as an empty list."""
    value = owner.get(key)
    if isinstance(value, str | bytes | bytearray) or not isinstance(value, Sequence):
        raise_invalid(line_number, key)
    return cast(Sequence[object], value)


def required_string(owner: Mapping[str, object], key: str, line_number: int) -> str:
    """Read a required non-empty string without including its value in errors."""
    value = owner.get(key)
    if not isinstance(value, str) or not value.strip():
        raise_invalid(line_number, key)
    return value


def _required_canonical_string(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
) -> str:
    """Read a database identity without trimming or exposing its source value."""
    value = required_string(owner, key, line_number)
    if value != value.strip():
        raise_invalid(line_number, key)
    return value


def required_numeric(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> Numeric:
    """Read one finite exact JSON number parsed directly as ``Decimal``."""
    value = owner.get(key)
    if not isinstance(value, Decimal) or not value.is_finite():
        raise_invalid(line_number, path)
    return Numeric(value)


def optional_numeric(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> Numeric | None:
    """Read a nullable finite exact JSON number."""
    if owner.get(key) is None:
        return None
    return required_numeric(owner, key, line_number, path)


def required_currency_code(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> str:
    """Read the uppercase three-letter currency form used by Economics."""
    currency_code = required_string(owner, key, line_number)
    if (
        len(currency_code) != 3
        or not currency_code.isascii()
        or not currency_code.isalpha()
        or not currency_code.isupper()
    ):
        raise_invalid(line_number, path)
    return currency_code


def optional_string(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> str | None:
    """Read a nullable non-empty string without including its value in errors."""
    value = owner.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise_invalid(line_number, path)
    return value


def optional_date(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
) -> date | None:
    """Read one nullable fee interval boundary without inventing a date."""
    return None if owner.get(key) is None else _required_date(owner, key, line_number)


def require_contained_interval(
    context: EconomicsRowContext,
    start_date: date | None,
    end_date: date | None,
    path: str,
) -> None:
    """Validate every present fee boundary inside its enclosing Economics row."""
    if start_date is not None and not context.start_date <= start_date <= context.end_date:
        raise_invalid(context.source_line_number, path)
    if end_date is not None and not context.start_date <= end_date <= context.end_date:
        raise_invalid(context.source_line_number, path)
    if start_date is not None and end_date is not None and start_date > end_date:
        raise_invalid(context.source_line_number, path)


def _required_date(owner: Mapping[str, object], key: str, line_number: int) -> date:
    """Read Amazon's canonical full-date scalar."""
    value = required_string(owner, key, line_number)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        parsed = None
    if parsed is None:
        raise_invalid(line_number, key)
    if parsed.isoformat() != value:
        raise_invalid(line_number, key)
    return parsed


def required_object(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    owner_path: str,
) -> Mapping[str, object]:
    """Read a required nested JSON object."""
    return object_value(owner.get(key), line_number, f"{owner_path}.{key}")


def optional_object(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    owner_path: str,
) -> Mapping[str, object] | None:
    """Read a nullable nested JSON object."""
    value = owner.get(key)
    if value is None:
        return None
    return object_value(value, line_number, f"{owner_path}.{key}")


def raise_invalid(line_number: int, path: str) -> Never:
    """Raise a value-redacting document error with only field and line context."""
    raise DataKioskEconomicsNormalizationError(
        f"The Data Kiosk Economics row has invalid {path} at source line {line_number}."
    )


__all__ = [
    "EconomicsRowContext",
    "object_value",
    "optional_array",
    "optional_date",
    "optional_numeric",
    "optional_object",
    "optional_string",
    "parse_row_context",
    "raise_invalid",
    "require_contained_interval",
    "required_array",
    "required_currency_code",
    "required_numeric",
    "required_object",
    "required_string",
]
