"""SP-API-only acquisition of exact FBA report document bodies."""

import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from ..reports.documents import download_report_document
from ..reports.summaries import DoneReportSummary
from .lifecycle import (
    DEFAULT_DISCOVERY_LOOKBACK_DAYS,
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
    FbaReportsClient,
    obtain_fba_report,
    request_and_poll_fba_report,
)
from .listing import list_done_fba_reports, select_covering_report
from .models import (
    AgedStorageReportWindow,
    DownloadedAgedStorageReport,
    DownloadedRemovalReport,
)
from .report_types import (
    FBA_AGED_STORAGE_FEE_REPORT,
    FBA_REMOVAL_ORDER_DETAIL_REPORT,
)
from .requests import validate_aged_storage_window, validate_removal_window


def download_aged_storage_report(
    client: FbaReportsClient,
    *,
    marketplace_id: str,
    window: AgedStorageReportWindow,
    now: datetime | None = None,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DownloadedAgedStorageReport:
    """Reuse or create a report and download its exact body without parsing it."""
    validate_aged_storage_window(window)
    acquisition_time = _aware_acquisition_time(now, context="Aged-storage")
    if window.report_request_end_at > acquisition_time:
        raise ValueError("Aged-storage report month must be closed before acquisition.")
    report = _obtain_aged_storage_report(
        client,
        marketplace_id=marketplace_id,
        window=window,
        discovery_created_since=(
            acquisition_time - timedelta(days=DEFAULT_DISCOVERY_LOOKBACK_DAYS)
        ),
        discovery_created_until=acquisition_time,
        max_poll_attempts=max_poll_attempts,
        poll_interval_seconds=poll_interval_seconds,
        sleep=sleep,
    )
    return DownloadedAgedStorageReport(
        report_summary=report,
        document=download_report_document(client, report.report_document_id, sleep=sleep),
    )


def download_removal_report(
    client: FbaReportsClient,
    *,
    marketplace_id: str,
    data_start_at: datetime,
    data_end_at: datetime,
    now: datetime | None = None,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DownloadedRemovalReport:
    """Reuse or create a report and download its exact body without parsing it."""
    acquisition_time = _aware_acquisition_time(now, context="Removal-report")
    validate_removal_window(data_start_at, data_end_at)
    if data_end_at > acquisition_time:
        raise ValueError("Removal-report data window must not end in the future.")
    report = obtain_fba_report(
        client,
        report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
        marketplace_ids=(marketplace_id,),
        data_start_at=data_start_at,
        data_end_at=data_end_at,
        discovery_created_since=(
            acquisition_time - timedelta(days=DEFAULT_DISCOVERY_LOOKBACK_DAYS)
        ),
        discovery_created_until=acquisition_time,
        max_poll_attempts=max_poll_attempts,
        poll_interval_seconds=poll_interval_seconds,
        sleep=sleep,
    )
    return DownloadedRemovalReport(
        report_summary=report,
        document=download_report_document(client, report.report_document_id, sleep=sleep),
    )


def _obtain_aged_storage_report(
    client: FbaReportsClient,
    *,
    marketplace_id: str,
    window: AgedStorageReportWindow,
    discovery_created_since: datetime,
    discovery_created_until: datetime,
    max_poll_attempts: int,
    poll_interval_seconds: float,
    sleep: Callable[[float], None],
) -> DoneReportSummary:
    reports = list_done_fba_reports(
        client,
        report_type=FBA_AGED_STORAGE_FEE_REPORT,
        marketplace_ids=(marketplace_id,),
        created_since=discovery_created_since,
        created_until=discovery_created_until,
        sleep=sleep,
    )
    covering = select_covering_report(
        reports,
        report_type=FBA_AGED_STORAGE_FEE_REPORT,
        marketplace_ids=(marketplace_id,),
        data_start_at=window.evidence_start_at,
        data_end_at=window.evidence_end_at,
    )
    if covering is not None:
        return covering
    return request_and_poll_fba_report(
        client,
        report_type=FBA_AGED_STORAGE_FEE_REPORT,
        marketplace_ids=(marketplace_id,),
        data_start_at=window.report_request_start_at,
        data_end_at=window.report_request_end_at,
        max_poll_attempts=max_poll_attempts,
        poll_interval_seconds=poll_interval_seconds,
        sleep=sleep,
    )


def _aware_acquisition_time(value: datetime | None, *, context: str) -> datetime:
    resolved = value or datetime.now(UTC)
    if resolved.tzinfo is None or resolved.utcoffset() is None:
        raise ValueError(f"{context} acquisition time must be timezone-aware.")
    return resolved


__all__ = ["download_aged_storage_report", "download_removal_report"]
