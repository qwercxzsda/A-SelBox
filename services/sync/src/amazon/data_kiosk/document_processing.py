"""Source-faithful decoding and simple parsing of Data Kiosk documents."""

import gzip
import hashlib
import json
import zlib
from collections.abc import Mapping
from contextlib import suppress
from decimal import Decimal
from io import StringIO
from typing import Never, cast

from .errors import DataKioskDocumentError
from .models import ParsedJsonlDocument, ParsedJsonlRow

_GZIP_MAGIC = b"\x1f\x8b"


def parse_jsonl_source_document(document: bytes) -> ParsedJsonlDocument:
    """Decode JSONL object rows without applying Economics business rules."""
    return _parse_decoded_jsonl(_decode_document(document))


def parse_json_document(document: bytes) -> object:
    """Decode any valid plain or gzip JSON root without logging its contents."""
    return _parse_exact_json(
        _decode_utf8(_decode_document(document)),
        error_message="The Data Kiosk document is not valid JSON.",
    )


def _decode_document(document: bytes) -> bytes:
    if not document.startswith(_GZIP_MAGIC):
        return document
    decoded_document: bytes | None = None
    with suppress(EOFError, OSError, zlib.error):
        decoded_document = gzip.decompress(document)
    if decoded_document is None:
        raise DataKioskDocumentError("The gzip Data Kiosk document is invalid.")
    return decoded_document


def _parse_decoded_jsonl(document: bytes) -> ParsedJsonlDocument:
    rows: list[ParsedJsonlRow] = []
    # Unicode separators can occur inside JSON strings; only physical newline
    # sequences delimit source rows.
    lines = StringIO(_decode_utf8(document), newline=None)
    for source_line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        rows.append(
            ParsedJsonlRow(
                source_line_number=source_line_number,
                value=_parse_jsonl_row(line, source_line_number),
            )
        )
    return ParsedJsonlDocument(
        decoded_sha256=hashlib.sha256(document, usedforsecurity=False).hexdigest(),
        rows=tuple(rows),
    )


def _parse_jsonl_row(line: str, source_line_number: int) -> Mapping[str, object]:
    parsed_row = _parse_exact_json(
        line,
        error_message=(
            f"The Data Kiosk document has invalid JSON at source line {source_line_number}."
        ),
    )
    if not isinstance(parsed_row, dict):
        raise DataKioskDocumentError(
            f"The Data Kiosk document row at source line {source_line_number} is not a JSON object."
        )
    return cast(dict[str, object], parsed_row)


def _parse_exact_json(text: str, *, error_message: str) -> object:
    """Parse exact JSON and raise only after the parser context has been discarded."""
    parse_failed = False
    parsed_value: object = None
    try:
        parsed_value = json.loads(
            text,
            object_pairs_hook=_unique_json_object,
            parse_float=Decimal,
            parse_int=Decimal,
            parse_constant=_reject_nonstandard_number,
        )
    except ValueError:
        parse_failed = True
    if parse_failed:
        raise DataKioskDocumentError(error_message)
    return parsed_value


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
    "parse_json_document",
    "parse_jsonl_source_document",
]
