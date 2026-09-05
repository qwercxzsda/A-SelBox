"""Lossless structural parser for Amazon Settlement V2 TSV documents."""

import hashlib
from collections.abc import Iterable
from io import BytesIO, TextIOWrapper

from .settlement_models import ParsedSettlementReport, SettlementReportContentRow
from .settlement_tabular import (
    SettlementTsvHeaderError,
    iter_settlement_tsv_rows,
    locate_settlement_tsv_header,
)

_SETTLEMENT_METADATA_COLUMNS: tuple[str, ...] = (
    "settlement-start-date",
    "settlement-end-date",
    "deposit-date",
    "total-amount",
    "currency",
)
_SETTLEMENT_TRANSACTION_COLUMNS: tuple[str, ...] = (
    "transaction-type",
    "order-id",
    "merchant-order-id",
    "adjustment-id",
    "shipment-id",
    "marketplace-name",
    "amount-type",
    "amount-description",
    "amount",
    "fulfillment-id",
    "posted-date",
    "posted-date-time",
    "order-item-code",
    "merchant-order-item-id",
    "merchant-adjustment-item-id",
    "sku",
    "quantity-purchased",
    "promotion-id",
)


def parse_settlement_report(report_content: bytes) -> ParsedSettlementReport:
    """Split a decoded TSV into exact metadata and content cell arrays."""
    report_bytes = _require_report_bytes(report_content)
    decoded_content_sha256 = hashlib.sha256(
        report_bytes,
        usedforsecurity=False,
    ).hexdigest()
    with TextIOWrapper(
        BytesIO(report_bytes),
        encoding="utf-8-sig",
        newline="",
    ) as report_file:
        try:
            header = locate_settlement_tsv_header(report_file)
        except SettlementTsvHeaderError as error:
            raise ValueError(str(error)) from None
        rows = iter_settlement_tsv_rows(report_file, header)
        try:
            metadata_source_line_number, metadata_values = next(rows)
        except StopIteration:
            raise ValueError("Settlement report is empty.") from None

        column_indexes = {column: index for index, column in enumerate(header.fields)}
        _validate_blank_columns(
            metadata_values,
            column_indexes,
            _SETTLEMENT_TRANSACTION_COLUMNS,
            row_role="metadata",
        )
        settlement_id = metadata_values[column_indexes["settlement-id"]]
        if not settlement_id.strip():
            raise ValueError("Missing required column settlement-id.")
        content_rows = _parse_content_rows(
            rows,
            column_indexes,
            settlement_id,
        )

    return ParsedSettlementReport(
        tsv_columns=header.fields,
        metadata_source_line_number=metadata_source_line_number,
        metadata_values=metadata_values,
        content_rows=content_rows,
        decoded_content_sha256=decoded_content_sha256,
    )


def _require_report_bytes(value: object) -> bytes:
    if not isinstance(value, bytes):
        raise TypeError("report_content must be bytes.")
    return value


def _parse_content_rows(
    rows: Iterable[tuple[int, tuple[str, ...]]],
    column_indexes: dict[str, int],
    settlement_id: str,
) -> tuple[SettlementReportContentRow, ...]:
    return tuple(
        _parse_content_row(
            values,
            source_line_number,
            column_indexes,
            settlement_id,
        )
        for source_line_number, values in rows
    )


def _parse_content_row(
    values: tuple[str, ...],
    source_line_number: int,
    column_indexes: dict[str, int],
    settlement_id: str,
) -> SettlementReportContentRow:
    _validate_blank_columns(
        values,
        column_indexes,
        _SETTLEMENT_METADATA_COLUMNS,
        row_role="transaction",
    )
    row_settlement_id = values[column_indexes["settlement-id"]]
    if not row_settlement_id.strip():
        raise ValueError("Missing required column settlement-id.")
    if row_settlement_id != settlement_id:
        raise ValueError(
            f"Settlement transaction row {source_line_number} has a different settlement-id."
        )
    return SettlementReportContentRow(
        source_line_number=source_line_number,
        column_values=values,
    )


def _validate_blank_columns(
    values: tuple[str, ...],
    column_indexes: dict[str, int],
    columns: Iterable[str],
    *,
    row_role: str,
) -> None:
    for column in columns:
        if values[column_indexes[column]].strip():
            raise ValueError(f"Settlement {row_role} row must leave column {column} blank.")


__all__ = ["parse_settlement_report"]
