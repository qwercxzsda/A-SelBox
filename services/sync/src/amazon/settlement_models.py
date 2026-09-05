"""Lossless structural Amazon Settlement report data."""

from dataclasses import dataclass, field
from datetime import datetime

from ..canonical_values import validate_sha256


@dataclass(frozen=True, slots=True)
class SettlementReportContentRow:
    """One exact-width Settlement content row in physical source order."""

    source_line_number: int
    column_values: tuple[str, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.source_line_number) is not int or self.source_line_number < 1:
            raise ValueError("source_line_number must be a positive integer.")


@dataclass(frozen=True, slots=True)
class ParsedSettlementReport:
    """Simple-parse result preserving every decoded TSV cell exactly."""

    tsv_columns: tuple[str, ...]
    metadata_source_line_number: int
    metadata_values: tuple[str, ...] = field(repr=False)
    content_rows: tuple[SettlementReportContentRow, ...] = field(repr=False)
    decoded_content_sha256: str

    def __post_init__(self) -> None:
        if not self.tsv_columns:
            raise ValueError("Settlement TSV columns must not be empty.")
        if any(not column for column in self.tsv_columns):
            raise ValueError("Settlement TSV columns must be nonempty strings.")
        if len(self.tsv_columns) != len(set(self.tsv_columns)):
            raise ValueError("Settlement TSV columns must be unique.")
        if (
            type(self.metadata_source_line_number) is not int
            or self.metadata_source_line_number < 1
        ):
            raise ValueError("metadata_source_line_number must be a positive integer.")
        if len(self.metadata_values) != len(self.tsv_columns):
            raise ValueError("Settlement metadata width must match its TSV columns.")
        if any(len(row.column_values) != len(self.tsv_columns) for row in self.content_rows):
            raise ValueError("Settlement content row width must match its TSV columns.")
        content_line_numbers = tuple(row.source_line_number for row in self.content_rows)
        if content_line_numbers != tuple(sorted(content_line_numbers)) or len(
            content_line_numbers
        ) != len(set(content_line_numbers)):
            raise ValueError("Settlement content rows must retain unique source order.")
        if content_line_numbers and content_line_numbers[0] <= self.metadata_source_line_number:
            raise ValueError("Settlement content rows must follow the metadata row.")
        validate_sha256(self.decoded_content_sha256, "decoded_content_sha256")

    @property
    def content_row_count(self) -> int:
        """Return the structurally parsed content-row inventory."""
        return len(self.content_rows)


@dataclass(frozen=True, slots=True)
class SettlementReportReference:
    """Identify one completed report returned by the Reports API."""

    report_id: str
    report_document_id: str
    report_created_at: datetime
    marketplace_ids: tuple[str, ...]
    report_data_start_at: datetime | None = None
    report_data_end_at: datetime | None = None


__all__ = [
    "ParsedSettlementReport",
    "SettlementReportContentRow",
    "SettlementReportReference",
]
