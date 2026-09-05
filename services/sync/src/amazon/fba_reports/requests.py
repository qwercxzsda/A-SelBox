"""Pure marketplace and request-window validation for FBA report acquisition."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import cast

from sp_api.base import Marketplaces

from .models import AgedStorageReportWindow


def calendar_month_aged_storage_windows(
    evidence_start_at: datetime,
    evidence_end_at: datetime,
) -> tuple[AgedStorageReportWindow, ...]:
    """Split evidence into calendar months without changing either endpoint."""
    validate_aware_window(evidence_start_at, evidence_end_at, context="Aged-storage")
    local_end = evidence_end_at.astimezone(evidence_start_at.tzinfo)
    month_start = evidence_start_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    windows: list[AgedStorageReportWindow] = []
    while month_start <= local_end:
        next_month = _next_calendar_month(month_start)
        windows.append(
            AgedStorageReportWindow(
                evidence_start_at=max(evidence_start_at, month_start),
                evidence_end_at=min(local_end, next_month - timedelta(microseconds=1)),
                report_request_start_at=month_start,
                report_request_end_at=next_month,
            )
        )
        month_start = next_month
    return tuple(windows)


def closed_calendar_month_aged_storage_windows(
    evidence_start_at: datetime,
    evidence_end_at: datetime,
    *,
    available_at: datetime,
) -> tuple[AgedStorageReportWindow, ...]:
    """Return only report months that had closed by the acquisition cutoff."""
    if available_at.tzinfo is None or available_at.utcoffset() is None:
        raise ValueError("Aged-storage availability cutoff must be timezone-aware.")
    return tuple(
        window
        for window in calendar_month_aged_storage_windows(
            evidence_start_at,
            evidence_end_at,
        )
        if window.report_request_end_at <= available_at
    )


def validate_aged_storage_window(window: AgedStorageReportWindow) -> None:
    """Validate one closed calendar-month request and its evidence slice."""
    validate_aware_window(
        window.evidence_start_at,
        window.evidence_end_at,
        context="Aged-storage",
    )
    validate_aware_window(
        window.report_request_start_at,
        window.report_request_end_at,
        context="Aged-storage report request",
    )
    if window.report_request_start_at.day != 1 or any(
        (
            window.report_request_start_at.hour,
            window.report_request_start_at.minute,
            window.report_request_start_at.second,
            window.report_request_start_at.microsecond,
        )
    ):
        raise ValueError("Aged-storage report request must start at a calendar-month boundary.")
    if window.report_request_end_at != _next_calendar_month(window.report_request_start_at):
        raise ValueError("Aged-storage report request must span exactly one calendar month.")
    if not (
        window.report_request_start_at
        <= window.evidence_start_at
        <= window.evidence_end_at
        < window.report_request_end_at
    ):
        raise ValueError("Aged-storage evidence must be contained by its report month.")


def validate_removal_window(data_start_at: datetime, data_end_at: datetime) -> None:
    """Validate the requested removal-report data interval."""
    validate_aware_window(data_start_at, data_end_at, context="Removal-report")


def validate_aware_window(
    start_at: datetime,
    end_at: datetime,
    *,
    context: str,
) -> None:
    """Require ordered instants with an explicit timezone at both boundaries."""
    if start_at.tzinfo is None or start_at.utcoffset() is None:
        raise ValueError(f"{context} start datetime must be timezone-aware.")
    if end_at.tzinfo is None or end_at.utcoffset() is None:
        raise ValueError(f"{context} end datetime must be timezone-aware.")
    if start_at > end_at:
        raise ValueError(f"{context} start datetime must not be after end datetime.")


def normalize_report_marketplaces(marketplace_ids: Sequence[str]) -> tuple[str, ...]:
    """Validate and deduplicate request IDs while preserving their input order."""
    if isinstance(marketplace_ids, str):
        raise TypeError("marketplace_ids must be a sequence, not text.")
    raw_marketplace_ids = cast(Sequence[object], marketplace_ids)
    values: list[str] = []
    for value in raw_marketplace_ids:
        if not isinstance(value, str) or not value or value != value.strip():
            raise ValueError("marketplace_ids must contain nonblank values.")
        if value not in values:
            values.append(value)
    if not values:
        raise ValueError("marketplace_ids must contain nonblank values.")
    if len(values) > len(Marketplaces):
        raise ValueError("marketplace_ids exceeds the installed marketplace registry bound.")
    return tuple(values)


def _next_calendar_month(value: datetime) -> datetime:
    if value.month == 12:
        return value.replace(year=value.year + 1, month=1)
    return value.replace(month=value.month + 1)


__all__ = [
    "calendar_month_aged_storage_windows",
    "closed_calendar_month_aged_storage_windows",
    "normalize_report_marketplaces",
    "validate_aged_storage_window",
    "validate_aware_window",
    "validate_removal_window",
]
