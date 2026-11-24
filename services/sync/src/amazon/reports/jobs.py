"""Bounded, sanitized Reports API job lifecycle for account and marketplace reports."""

import math
import time
from collections.abc import Callable, Mapping
from typing import Protocol

from ...inventory.serialization import mapping, text
from ..transport import sanitized_throttled_api_call
from .sdk_types import ReportDocumentClient, ReportDocumentMetadataResponse

DEFAULT_MAX_POLL_ATTEMPTS = 60
DEFAULT_POLL_INTERVAL_SECONDS = 10.0


class ReportsClient(ReportDocumentClient, Protocol):
    def create_report(self, **kwargs: object) -> ReportDocumentMetadataResponse: ...

    def get_report(self, report_id: str, /) -> ReportDocumentMetadataResponse: ...


def request_report(
    client: ReportsClient,
    marketplace_id: str,
    *,
    report_type: str,
    options: Mapping[str, object] | None = None,
    allow_cancelled: bool = False,
    report_id: str | None = None,
    on_report_id: Callable[[str], None] | None = None,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> Mapping[str, object]:
    """Request or resume a full report; unsuccessful jobs are never zero stock."""
    if type(max_poll_attempts) is not int or max_poll_attempts < 1:
        raise ValueError("Report max_poll_attempts must be a positive integer.")
    if (
        type(poll_interval_seconds) not in (float, int)
        or not math.isfinite(poll_interval_seconds)
        or not 0 <= poll_interval_seconds <= 60
    ):
        raise ValueError("Report poll interval must be finite and between 0 and 60 seconds.")
    if report_id is None:
        response = sanitized_throttled_api_call(
            lambda: client.create_report(
                reportType=report_type, marketplaceIds=[marketplace_id], **(options or {})
            ),
            safe_error=RuntimeError("Amazon report request failed."),
            sleep=sleep,
        )
        report_id = _identifier(mapping(response.payload), "reportId")
    else:
        report_id = _identifier({"reportId": report_id}, "reportId")
    # Preserve the recovery handle before polling can fail or time out.
    if on_report_id is not None:
        on_report_id(report_id)
    for attempt in range(max_poll_attempts):
        response = sanitized_throttled_api_call(
            lambda: client.get_report(report_id),
            safe_error=RuntimeError("Amazon report status request failed."),
            sleep=sleep,
        )
        payload = mapping(response.payload)
        if payload.get("reportId") != report_id:
            raise ValueError("Amazon report response has the wrong report identity.")
        if payload.get("reportType") != report_type:
            raise ValueError("Amazon report response has the wrong report type.")
        if payload.get("marketplaceIds") != [marketplace_id]:
            raise ValueError("Amazon report response has the wrong marketplace scope.")
        status = payload.get("processingStatus")
        if status == "DONE":
            _identifier(payload, "reportDocumentId")
            _identifier(payload, "createdTime")
            return payload
        if status == "CANCELLED" and allow_cancelled:
            return payload
        if status in ("CANCELLED", "FATAL"):
            raise RuntimeError("Amazon report did not produce a successful document.")
        if status not in ("IN_QUEUE", "IN_PROGRESS"):
            raise ValueError("Amazon report returned an unknown processing status.")
        if attempt + 1 < max_poll_attempts:
            sleep(poll_interval_seconds)
    raise TimeoutError("Amazon report exceeded its configured polling bound.")


def safe_report_metadata(payload: Mapping[str, object]) -> dict[str, object]:
    """Allow only documented scalar provenance; exclude transport URLs and unknown fields."""
    keys = (
        "reportId",
        "reportType",
        "reportDocumentId",
        "createdTime",
        "processingStatus",
        "processingStartTime",
        "processingEndTime",
        "dataStartTime",
        "dataEndTime",
    )
    return {key: text(payload[key]) for key in keys if payload.get(key) is not None}


def _identifier(payload: Mapping[str, object], key: str) -> str:
    value = text(payload.get(key))
    if not value or value != value.strip():
        raise ValueError("Amazon report response omitted a required identifier.")
    return value
