"""Retained FBA report values shared across acquisition and processing."""

from dataclasses import dataclass, field
from datetime import datetime

from ...canonical_values import validate_sha256
from ..reports.models import DownloadedReportDocument
from ..reports.summaries import DoneReportSummary
from .report_types import (
    FBA_AGED_STORAGE_FEE_REPORT,
    FBA_REMOVAL_ORDER_DETAIL_REPORT,
)


@dataclass(frozen=True, slots=True)
class AgedStorageReportWindow:
    """One evidence slice and its Amazon-required calendar-month request."""

    evidence_start_at: datetime
    evidence_end_at: datetime
    report_request_start_at: datetime
    report_request_end_at: datetime


@dataclass(frozen=True, slots=True)
class DownloadedAgedStorageReport:
    """Completed aged-storage report metadata and its exact transferred body."""

    report_summary: DoneReportSummary
    document: DownloadedReportDocument = field(repr=False)

    def __post_init__(self) -> None:
        if self.report_summary.report_type != FBA_AGED_STORAGE_FEE_REPORT:
            raise ValueError("Downloaded report is not an aged-storage fee report.")


@dataclass(frozen=True, slots=True)
class DownloadedRemovalReport:
    """Completed removal report metadata and its exact transferred body."""

    report_summary: DoneReportSummary
    document: DownloadedReportDocument = field(repr=False)

    def __post_init__(self) -> None:
        if self.report_summary.report_type != FBA_REMOVAL_ORDER_DETAIL_REPORT:
            raise ValueError("Downloaded report is not a removal-order detail report.")


@dataclass(frozen=True, slots=True)
class ParsedFbaReportRow:
    """One generic TSV row retaining exact column order and physical line."""

    source_line_number: int
    values: tuple[str, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.source_line_number) is not int or self.source_line_number < 2:
            raise ValueError("FBA source_line_number must be at least 2.")


@dataclass(frozen=True, slots=True)
class ParsedFbaReportDocument:
    """Simple-parse output for one decoded generic TSV report document."""

    amazon_scope: str
    report_type: str
    content_sha256: str
    header: tuple[str, ...]
    rows: tuple[ParsedFbaReportRow, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if not self.amazon_scope.strip() or not self.report_type.strip():
            raise ValueError("Parsed FBA scope and report type must not be blank.")
        validate_sha256(self.content_sha256, "content_sha256")
        if not self.header:
            raise ValueError("A parsed FBA report requires a TSV header.")
        if len(self.header) != len(set(self.header)):
            raise ValueError("A parsed FBA report cannot contain duplicate header columns.")
        if any(len(row.values) != len(self.header) for row in self.rows):
            raise ValueError("Every parsed FBA row must match the header width.")
        line_numbers = tuple(row.source_line_number for row in self.rows)
        if line_numbers != tuple(sorted(line_numbers)) or len(line_numbers) != len(
            set(line_numbers)
        ):
            raise ValueError("Parsed FBA rows must retain unique source order.")


__all__ = [
    "AgedStorageReportWindow",
    "DownloadedAgedStorageReport",
    "DownloadedRemovalReport",
    "ParsedFbaReportDocument",
    "ParsedFbaReportRow",
]
