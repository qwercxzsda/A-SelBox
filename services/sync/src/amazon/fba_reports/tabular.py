"""Business-value helpers for structurally parsed FBA TSV rows."""

import json
import re
from collections.abc import Collection, Iterator, Mapping
from contextlib import suppress
from datetime import date
from hashlib import sha256

from ...numeric import Numeric
from .models import ParsedFbaReportDocument

_NUMBER_PATTERN = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")


def iter_normalized_parsed_tsv_rows(
    document: ParsedFbaReportDocument,
    *,
    report_name: str,
    required_columns: Collection[str],
) -> Iterator[tuple[int, dict[str, str]]]:
    """Apply report schema validation and strip values for business normalization."""
    missing_columns = sorted(set(required_columns).difference(document.header))
    if missing_columns:
        raise ValueError(
            f"{report_name} is missing required columns: " + ", ".join(missing_columns)
        )
    for parsed_row in document.rows:
        yield (
            parsed_row.source_line_number,
            dict(
                zip(
                    document.header,
                    (value.strip() for value in parsed_row.values),
                    strict=True,
                )
            ),
        )


def required_value(
    row: Mapping[str, str],
    column: str,
    source_line_number: int,
    *,
    report_name: str,
) -> str:
    """Return one nonblank value with a row-safe validation error."""
    value = row.get(column, "").strip()
    if not value:
        raise ValueError(f"{report_name} line {source_line_number} is missing required {column}.")
    return value


def numeric_token(value: str, field_name: str, *, report_name: str) -> Numeric:
    """Parse an Amazon decimal token without floats, quantization, or rounding."""
    normalized = value.strip()
    if not _NUMBER_PATTERN.fullmatch(normalized):
        raise ValueError(f"{report_name} {field_name} is not an exact decimal token.")
    return Numeric(normalized.replace(",", "."))


def optional_nonzero_charge(
    value: str,
    field_name: str,
    *,
    report_name: str,
) -> Numeric | None:
    """Return a positive source charge, omitting blank and exact-zero values."""
    if not value:
        return None
    amount = numeric_token(value, field_name, report_name=report_name)
    if not amount:
        return None
    if amount < 0:
        raise ValueError(f"{report_name} {field_name} must not be negative.")
    return amount


def currency_code(value: str, field_name: str, *, report_name: str) -> str:
    """Normalize and validate one three-letter report currency code."""
    normalized = value.strip().upper()
    if len(normalized) != 3 or not normalized.isascii() or not normalized.isalpha():
        raise ValueError(f"{report_name} {field_name} is not a three-letter currency code.")
    return normalized


def report_date_token(value: str, field_name: str, *, report_name: str) -> date:
    """Parse the ISO or localized dates observed in Amazon FBA flat files."""
    normalized = value.strip()
    date_token = normalized[:10]
    has_valid_suffix = len(normalized) <= 10 or normalized[10] in {"T", " "}
    if has_valid_suffix:
        with suppress(ValueError):
            parsed = date.fromisoformat(date_token)
            if parsed.isoformat() == date_token:
                return parsed
    dotted = date_token.split(".")
    if has_valid_suffix and len(dotted) == 3:
        with suppress(ValueError):
            parsed = date(int(dotted[2]), int(dotted[1]), int(dotted[0]))
            if f"{parsed.day:02d}.{parsed.month:02d}.{parsed.year:04d}" == date_token:
                return parsed
    raise ValueError(f"{report_name} {field_name} has an unsupported date.")


def report_row_reference_hash(
    report_type: str,
    row: Mapping[str, str],
    source_line_number: int,
) -> str:
    """Hash the complete exact normalized row and its position as immutable lineage."""
    payload = {
        "report_type": report_type,
        "source_line_number": source_line_number,
        "row": dict(row),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(encoded.encode("utf-8")).hexdigest()


__all__ = [
    "currency_code",
    "iter_normalized_parsed_tsv_rows",
    "numeric_token",
    "optional_nonzero_charge",
    "report_date_token",
    "report_row_reference_hash",
    "required_value",
]
