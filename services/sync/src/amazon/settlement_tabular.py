"""Shared strict reader for observed Settlement V2 flat-file layouts."""

import csv
from collections.abc import Iterator
from dataclasses import dataclass
from typing import TextIO

SETTLEMENT_V2_COLUMNS: tuple[str, ...] = (
    "settlement-id",
    "settlement-start-date",
    "settlement-end-date",
    "deposit-date",
    "total-amount",
    "currency",
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

_REQUIRED_COLUMNS = frozenset(SETTLEMENT_V2_COLUMNS)
_OBSERVED_PREAMBLE_SHAPES: frozenset[tuple[tuple[int, int], ...]] = frozenset(
    {
        (),
        ((1, 1), (1, 1), (1, 1), (1, 1), (1, 1), (2, 0)),
    }
)


class SettlementTsvHeaderError(ValueError):
    """Raised when a nonempty report lacks one supported Settlement V2 header layout."""


@dataclass(frozen=True)
class SettlementTsvHeader:
    """Validated header fields and their one-based source line."""

    fields: tuple[str, ...]
    source_line_number: int


def locate_settlement_tsv_header(report_file: TextIO) -> SettlementTsvHeader:
    """Locate the canonical header at line 1 or after the observed six-line preamble."""
    reader = csv.reader(report_file, delimiter="\t", quoting=csv.QUOTE_NONE)
    preamble_shape: list[tuple[int, int]] = []
    for source_line_number, row in enumerate(reader, start=1):
        distinct_fields = set(row)
        overlap_count = len(_REQUIRED_COLUMNS.intersection(distinct_fields))
        if overlap_count >= len(_REQUIRED_COLUMNS) - 1 and len(row) != len(distinct_fields):
            raise SettlementTsvHeaderError("Settlement report has duplicate header columns.")
        if _REQUIRED_COLUMNS.issubset(distinct_fields):
            if tuple(preamble_shape) not in _OBSERVED_PREAMBLE_SHAPES:
                raise SettlementTsvHeaderError(
                    "Settlement report has an unsupported preamble before its header."
                )
            return SettlementTsvHeader(tuple(row), source_line_number)

        if overlap_count >= len(_REQUIRED_COLUMNS) - 1:
            missing_columns = sorted(_REQUIRED_COLUMNS.difference(distinct_fields))
            raise SettlementTsvHeaderError(
                "Settlement report is missing required header columns: "
                + ", ".join(missing_columns)
            )

        preamble_shape.append((len(row), sum(bool(value.strip()) for value in row)))
        current_shape = tuple(preamble_shape)
        if not any(
            shape[: len(current_shape)] == current_shape for shape in _OBSERVED_PREAMBLE_SHAPES
        ):
            raise SettlementTsvHeaderError(
                "Settlement report has an unsupported preamble or header."
            )

    raise SettlementTsvHeaderError("Settlement report is missing its header.")


def iter_settlement_tsv_rows(
    report_file: TextIO,
    header: SettlementTsvHeader,
) -> Iterator[tuple[int, tuple[str, ...]]]:
    """Yield exact-width rows after a located header with real source line numbers."""
    reader = csv.reader(report_file, delimiter="\t", quoting=csv.QUOTE_NONE)
    for source_line_number, row in enumerate(
        reader,
        start=header.source_line_number + 1,
    ):
        if len(row) > len(header.fields):
            raise ValueError(
                f"Settlement report row {source_line_number} has more values than header columns."
            )
        if len(row) < len(header.fields):
            raise ValueError(
                f"Settlement report row {source_line_number} has fewer values than header columns."
            )
        yield source_line_number, tuple(row)


__all__ = [
    "SETTLEMENT_V2_COLUMNS",
    "SettlementTsvHeader",
    "SettlementTsvHeaderError",
    "iter_settlement_tsv_rows",
    "locate_settlement_tsv_header",
]
