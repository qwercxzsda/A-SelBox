"""Shared strict parsing for completed Reports API summaries."""

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from ..datetimes import parse_amazon_datetime


@dataclass(frozen=True)
class DoneReportSummary:
    """Stable, validated fields shared by Reports API consumers."""

    report_id: str
    report_document_id: str
    report_type: str
    created_at: datetime
    data_start_at: datetime | None
    data_end_at: datetime | None
    marketplace_ids: tuple[str, ...]


def parse_done_report_summary(
    report: Mapping[str, object],
    *,
    expected_report_types: Collection[str],
) -> DoneReportSummary:
    """Parse one direct ``getReports``/``getReport`` summary without fallbacks."""
    report_type = _required_text(report, "reportType")
    if report_type not in expected_report_types:
        raise ValueError("Reports API returned an unexpected report type.")
    if _required_text(report, "processingStatus") != "DONE":
        raise ValueError("Reports API returned an unexpected processing status.")

    created_at = _required_datetime(report, "createdTime")
    data_start_at = _optional_datetime(report, "dataStartTime")
    data_end_at = _optional_datetime(report, "dataEndTime")
    if data_start_at is not None and data_end_at is not None and data_start_at > data_end_at:
        raise ValueError("Reports API returned an invalid report data window.")

    marketplace_ids = _required_marketplace_ids(report)
    return DoneReportSummary(
        report_id=_required_text(report, "reportId"),
        report_document_id=_required_text(report, "reportDocumentId"),
        report_type=report_type,
        created_at=created_at,
        data_start_at=data_start_at,
        data_end_at=data_end_at,
        marketplace_ids=marketplace_ids,
    )


def _required_text(report: Mapping[str, object], key: str) -> str:
    value = report.get(key)
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"Reports API report summary omitted required {key}.")
    return value


def _required_datetime(report: Mapping[str, object], key: str) -> datetime:
    parsed = _optional_datetime(report, key)
    if parsed is None:
        raise ValueError(f"Reports API report summary omitted required {key}.")
    return parsed


def _optional_datetime(report: Mapping[str, object], key: str) -> datetime | None:
    value = report.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"Reports API report summary has invalid {key}.")
    try:
        parsed = parse_amazon_datetime(value)
    except ValueError:
        raise ValueError(f"Reports API report summary has invalid {key}.") from None
    return parsed


def _required_marketplace_ids(report: Mapping[str, object]) -> tuple[str, ...]:
    raw_marketplace_ids = report.get("marketplaceIds")
    if not isinstance(raw_marketplace_ids, list) or not raw_marketplace_ids:
        raise ValueError("Reports API report summary omitted required marketplaceIds.")
    marketplace_values = cast(list[object], raw_marketplace_ids)
    if any(
        not isinstance(value, str) or not value or value != value.strip()
        for value in marketplace_values
    ):
        raise ValueError("Reports API report summary has invalid marketplaceIds.")
    marketplace_ids = cast(list[str], marketplace_values)
    if len(marketplace_ids) != len(set(marketplace_ids)):
        raise ValueError("Reports API report summary has duplicate marketplaceIds.")
    return tuple(sorted(marketplace_ids))


__all__ = ["DoneReportSummary", "parse_done_report_summary"]
