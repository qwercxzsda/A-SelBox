"""Create and poll bounded FBA report jobs, reusing completed reports when available."""

import time
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from math import isfinite
from typing import Protocol, cast

from ..reports.errors import ReportResponseError
from ..reports.sdk_types import ReportDocumentClient, ReportsListClient
from ..reports.summaries import DoneReportSummary
from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sanitized_throttled_api_call,
)
from .listing import list_done_fba_reports, select_covering_report
from .requests import normalize_report_marketplaces, validate_aware_window
from .responses import has_exact_marketplace_scope, parse_done_fba_report

DEFAULT_DISCOVERY_LOOKBACK_DAYS = 90
DEFAULT_MAX_POLL_ATTEMPTS = 120
DEFAULT_POLL_INTERVAL_SECONDS = 5.0


class ReportsResponse(Protocol):
    """Reports SDK response data consumed by the lifecycle."""

    @property
    def payload(self) -> object: ...


class _ReportsClient(ReportsListClient, Protocol):
    """Narrow Reports API surface used by auxiliary report acquisition."""

    def create_report(self, **kwargs: object) -> ReportsResponse: ...

    def get_report(
        self,
        report_id: str,
        /,
        **kwargs: object,
    ) -> ReportsResponse: ...


class FbaReportsClient(_ReportsClient, ReportDocumentClient, Protocol):
    """Reports API surface needed to acquire and download FBA evidence."""


class FbaReportPollingTimeoutError(RuntimeError):
    """Raised when an FBA report remains non-terminal beyond the poll bound."""


class FbaReportFailedError(RuntimeError):
    """Raised when Amazon finishes an FBA report in a failed terminal state."""

    def __init__(self, processing_status: str) -> None:
        super().__init__(f"FBA report finished with status {processing_status}.")
        self.processing_status = processing_status


def request_fba_report(
    client: _ReportsClient,
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    data_start_at: datetime,
    data_end_at: datetime,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Create one FBA report request and return its opaque identifier."""
    if not report_type.strip():
        raise ValueError("report_type must not be blank.")
    validate_aware_window(data_start_at, data_end_at, context="FBA report data")
    normalized_marketplaces = normalize_report_marketplaces(marketplace_ids)
    response = _reports_api_call(
        lambda: client.create_report(
            reportType=report_type,
            marketplaceIds=list(normalized_marketplaces),
            dataStartTime=data_start_at,
            dataEndTime=data_end_at,
        ),
        safe_error=ReportResponseError("Reports API createReport request failed."),
        sleep=sleep,
    )
    return _required_text(_payload(response, "createReport"), "reportId", "createReport")


def poll_fba_report(
    client: _ReportsClient,
    report_id: str,
    *,
    max_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DoneReportSummary:
    """Poll one report until DONE with explicit bounds and terminal failures."""
    if not report_id or report_id != report_id.strip():
        raise ValueError("report_id must not be blank.")
    if type(max_attempts) is not int or max_attempts < 1:
        raise ValueError("max_attempts must be positive.")
    if (
        type(poll_interval_seconds) not in (int, float)
        or poll_interval_seconds < 0
        or not isfinite(poll_interval_seconds)
    ):
        raise ValueError("poll_interval_seconds must be finite and non-negative.")

    for attempt in range(max_attempts):
        response = _reports_api_call(
            lambda: client.get_report(report_id),
            safe_error=ReportResponseError("Reports API getReport request failed."),
            sleep=sleep,
        )
        payload = _payload(response, "getReport")
        returned_report_id = _required_text(payload, "reportId", "getReport")
        if returned_report_id != report_id:
            raise RuntimeError("getReport response reportId did not match the request.")
        status = _required_text(payload, "processingStatus", "getReport")
        if status == "DONE":
            return parse_done_fba_report(
                payload, _required_text(payload, "reportType", "getReport")
            )
        if status in {"CANCELLED", "FATAL"}:
            raise FbaReportFailedError(status)
        if status not in {"IN_QUEUE", "IN_PROGRESS"}:
            raise RuntimeError("getReport returned an unsupported processing status.")
        if attempt + 1 < max_attempts:
            sleep(poll_interval_seconds)

    raise FbaReportPollingTimeoutError(
        f"FBA report did not finish within {max_attempts} polling attempts."
    )


def request_and_poll_fba_report(
    client: _ReportsClient,
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    data_start_at: datetime,
    data_end_at: datetime,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DoneReportSummary:
    """Create and poll a report without interpreting terminal failure reasons."""
    normalized_marketplaces = normalize_report_marketplaces(marketplace_ids)
    report_id = request_fba_report(
        client,
        report_type=report_type,
        marketplace_ids=normalized_marketplaces,
        data_start_at=data_start_at,
        data_end_at=data_end_at,
        sleep=sleep,
    )
    report = poll_fba_report(
        client,
        report_id,
        max_attempts=max_poll_attempts,
        poll_interval_seconds=poll_interval_seconds,
        sleep=sleep,
    )
    if report.report_type != report_type:
        raise RuntimeError("getReport response reportType did not match the request.")
    if not has_exact_marketplace_scope(report, normalized_marketplaces):
        raise RuntimeError("FBA report marketplace scope does not match the request.")
    if (
        report.data_start_at is None
        or report.data_end_at is None
        or report.data_start_at > data_start_at
        or report.data_end_at < data_end_at
    ):
        raise RuntimeError("getReport response data window did not cover the request.")
    return report


def obtain_fba_report(
    client: _ReportsClient,
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    data_start_at: datetime,
    data_end_at: datetime,
    discovery_created_since: datetime,
    discovery_created_until: datetime,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DoneReportSummary:
    """Reuse one covering DONE report, otherwise request and wait for one."""
    if not report_type.strip():
        raise ValueError("report_type must not be blank.")
    validate_aware_window(data_start_at, data_end_at, context="FBA report data")
    normalized_marketplaces = normalize_report_marketplaces(marketplace_ids)
    existing = list_done_fba_reports(
        client,
        report_type=report_type,
        marketplace_ids=normalized_marketplaces,
        created_since=discovery_created_since,
        created_until=discovery_created_until,
        sleep=sleep,
    )
    covering = select_covering_report(
        existing,
        report_type=report_type,
        marketplace_ids=normalized_marketplaces,
        data_start_at=data_start_at,
        data_end_at=data_end_at,
    )
    if covering is not None:
        return covering
    return request_and_poll_fba_report(
        client,
        report_type=report_type,
        marketplace_ids=normalized_marketplaces,
        data_start_at=data_start_at,
        data_end_at=data_end_at,
        max_poll_attempts=max_poll_attempts,
        poll_interval_seconds=poll_interval_seconds,
        sleep=sleep,
    )


def _reports_api_call[ResultT](
    operation: Callable[[], ResultT],
    *,
    safe_error: Exception,
    sleep: Callable[[float], None],
) -> ResultT:
    """Retry only explicit bounded Reports 429 responses."""
    return sanitized_throttled_api_call(
        operation,
        safe_error=safe_error,
        max_attempts=DEFAULT_THROTTLE_MAX_ATTEMPTS,
        retry_delay_seconds=DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
        max_retry_after_seconds=MAX_THROTTLE_RETRY_AFTER_SECONDS,
        sleep=sleep,
    )


def _payload(response: object, operation: str) -> Mapping[str, object]:
    payload = getattr(response, "payload", None)
    if not isinstance(payload, Mapping):
        raise RuntimeError(f"{operation} returned an invalid payload.")
    return cast(Mapping[str, object], payload)


def _required_text(source: Mapping[str, object], key: str, context: str) -> str:
    value = source.get(key)
    if not isinstance(value, str) or not value or value != value.strip():
        raise RuntimeError(f"{context} is missing {key}.")
    return value


__all__ = [
    "DEFAULT_DISCOVERY_LOOKBACK_DAYS",
    "FbaReportFailedError",
    "FbaReportPollingTimeoutError",
    "FbaReportsClient",
    "obtain_fba_report",
    "poll_fba_report",
    "request_and_poll_fba_report",
    "request_fba_report",
]
