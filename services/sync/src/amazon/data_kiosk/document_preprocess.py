"""Source-faithful decoding and simple parsing of Data Kiosk documents."""

import hashlib
import json
from contextlib import suppress
from decimal import Decimal, InvalidOperation
from io import StringIO
from typing import Never, cast

from .errors import DataKioskDocumentError
from .models import ParsedJsonlDocument, ParsedJsonlRow


def parse_jsonl_source_document(document: bytes) -> ParsedJsonlDocument:
    """Parse archived decoded bytes; transport compression belongs to acquisition."""
    rows: list[ParsedJsonlRow] = []
    # Unicode separators can occur inside JSON strings; only physical newline
    # sequences delimit source rows.
    lines = StringIO(_decode_utf8(document), newline=None)
    for source_line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        rows.append(_parse_jsonl_row(line, source_line_number))
    return ParsedJsonlDocument(
        decoded_sha256=hashlib.sha256(document, usedforsecurity=False).hexdigest(),
        rows=tuple(rows),
    )


def _parse_jsonl_row(line: str, source_line_number: int) -> ParsedJsonlRow:
    """Parse and freeze exact JSON before discarding any source-bearing failure context."""
    with suppress(ValueError, InvalidOperation, RecursionError):
        parsed_row: object = json.loads(
            line,
            object_pairs_hook=_unique_json_object,
            parse_float=Decimal,
            parse_int=Decimal,
            parse_constant=_reject_nonstandard_number,
        )
        if not isinstance(parsed_row, dict):
            raise DataKioskDocumentError(
                f"The Data Kiosk document row at source line {source_line_number} "
                "is not a JSON object."
            )
        return ParsedJsonlRow(
            source_line_number=source_line_number,
            value=cast(dict[str, object], parsed_row),
        )
    raise DataKioskDocumentError(
        f"The Data Kiosk document has invalid JSON at source line {source_line_number}."
    )


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON object keys are not accepted.")
        value[key] = item
    return value


def _reject_nonstandard_number(_value: str) -> Never:
    raise ValueError("Non-standard JSON numeric constants are not accepted.")


def _decode_utf8(document: bytes) -> str:
    decoded_document: str | None = None
    with suppress(UnicodeDecodeError):
        decoded_document = document.decode("utf-8-sig")
    if decoded_document is None:
        raise DataKioskDocumentError("The Data Kiosk document is not valid UTF-8.")
    return decoded_document


__all__ = [
    "parse_jsonl_source_document",
]
