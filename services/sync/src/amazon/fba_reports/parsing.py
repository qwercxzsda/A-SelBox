"""Stage-one decompression and structural parsing for downloaded FBA reports."""

import csv
from contextlib import suppress
from hashlib import sha256
from io import StringIO

from ..reports.decoding import decompress_report_document
from ..scopes import AMAZON_SCOPES
from .models import (
    DownloadedAgedStorageReport,
    DownloadedRemovalReport,
    ParsedFbaReportDocument,
    ParsedFbaReportRow,
)
from .report_types import (
    FBA_AGED_STORAGE_FEE_REPORT,
    FBA_REMOVAL_ORDER_DETAIL_REPORT,
)

_AGED_STORAGE_REPORT_NAME = "FBA aged-storage fee report"
_REMOVAL_REPORT_NAME = "FBA removal report"
_SUPPORTED_SCOPES = frozenset(AMAZON_SCOPES)
_GENERIC_ENCODING_BY_REPORT_TYPE = {
    FBA_AGED_STORAGE_FEE_REPORT: "utf-8-sig",
    FBA_REMOVAL_ORDER_DETAIL_REPORT: "utf-8-sig",
}
_LIVE_OBSERVED_ENCODING_BY_SCOPE_AND_REPORT = {
    ("JAPAN", FBA_AGED_STORAGE_FEE_REPORT): "cp932",
}


def parse_aged_storage_fee_document(
    document: bytes,
    *,
    amazon_scope: str,
) -> ParsedFbaReportDocument:
    """Simple-parse an aged-storage TSV without validating field values."""
    return parse_fba_tsv_document(
        document,
        amazon_scope=amazon_scope,
        report_type=FBA_AGED_STORAGE_FEE_REPORT,
        report_name=_AGED_STORAGE_REPORT_NAME,
    )


def parse_removal_fee_document(
    document: bytes,
    *,
    amazon_scope: str,
) -> ParsedFbaReportDocument:
    """Simple-parse a removal TSV without interpreting its business values."""
    return parse_fba_tsv_document(
        document,
        amazon_scope=amazon_scope,
        report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
        report_name=_REMOVAL_REPORT_NAME,
    )


def parse_fba_tsv_document(
    document: bytes,
    *,
    amazon_scope: str,
    report_type: str,
    report_name: str,
) -> ParsedFbaReportDocument:
    """Decode and parse generic TSV shape without interpreting field values."""
    text = _decode_document(
        document,
        amazon_scope=amazon_scope,
        report_type=report_type,
        report_name=report_name,
    )
    reader = csv.reader(StringIO(text, newline=""), delimiter="\t", strict=True)
    fieldnames = tuple(next(reader, ()))
    if not fieldnames:
        raise ValueError(f"{report_name} is missing its TSV header.")
    if len(fieldnames) != len(set(fieldnames)):
        raise ValueError(f"{report_name} contains duplicate header columns.")
    rows: list[ParsedFbaReportRow] = []
    source_line_number = reader.line_num + 1
    for raw_values in reader:
        if len(raw_values) > len(fieldnames):
            raise ValueError(
                f"{report_name} line {source_line_number} has more values than header columns."
            )
        if len(raw_values) < len(fieldnames):
            raise ValueError(
                f"{report_name} line {source_line_number} has fewer values than header columns."
            )
        rows.append(
            ParsedFbaReportRow(
                source_line_number=source_line_number,
                values=tuple(raw_values),
            )
        )
        source_line_number = reader.line_num + 1
    return ParsedFbaReportDocument(
        amazon_scope=amazon_scope,
        report_type=report_type,
        content_sha256=sha256(document, usedforsecurity=False).hexdigest(),
        header=fieldnames,
        rows=tuple(rows),
    )


def _decode_document(
    document: bytes,
    *,
    amazon_scope: str,
    report_type: str,
    report_name: str,
) -> str:
    """Decode one FBA flat file with its explicit scope/report policy."""
    generic_encoding = _GENERIC_ENCODING_BY_REPORT_TYPE.get(report_type)
    if amazon_scope not in _SUPPORTED_SCOPES or generic_encoding is None:
        raise ValueError(f"{report_name} has no configured document encoding.")
    # UTF-8 is the supported-report baseline, not a claim that every possible
    # scope/report pair was observed live. Keep evidence-backed exceptions in a
    # separate table so one country's document cannot enable codec fallback for
    # another country or report type.
    encoding = _LIVE_OBSERVED_ENCODING_BY_SCOPE_AND_REPORT.get(
        (amazon_scope, report_type),
        generic_encoding,
    )
    decoded_document: str | None = None
    with suppress(UnicodeDecodeError):
        decoded_document = document.decode(encoding)
    if decoded_document is None:
        raise ValueError(f"{report_name} is not valid {encoding}.")
    return decoded_document


def parse_downloaded_aged_storage_report(
    downloaded: DownloadedAgedStorageReport,
    *,
    amazon_scope: str,
) -> ParsedFbaReportDocument:
    """Decompress and simple-parse an aged-storage report without business rules."""
    return parse_aged_storage_fee_document(
        decompress_report_document(downloaded.document),
        amazon_scope=amazon_scope,
    )


def parse_downloaded_removal_report(
    downloaded: DownloadedRemovalReport,
    *,
    amazon_scope: str,
) -> ParsedFbaReportDocument:
    """Decompress and simple-parse a removal report without business rules."""
    return parse_removal_fee_document(
        decompress_report_document(downloaded.document),
        amazon_scope=amazon_scope,
    )


__all__ = [
    "parse_aged_storage_fee_document",
    "parse_downloaded_aged_storage_report",
    "parse_downloaded_removal_report",
    "parse_fba_tsv_document",
    "parse_removal_fee_document",
]
