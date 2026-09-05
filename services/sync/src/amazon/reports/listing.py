"""Shared mechanics for listing completed Amazon reports."""

import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import datetime
from enum import Enum, auto

from ..datetimes import as_utc
from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sanitized_throttled_api_call,
)
from .errors import ReportResponseError
from .sdk_types import ReportsListClient, ReportsPage

_MAX_MARKETPLACE_IDS_PER_REQUEST = 10


class ReportIdentityCollision(Enum):
    """Ways a Reports response can violate report/document identity."""

    CONFLICTING_METADATA = auto()
    REUSED_DOCUMENT_ID = auto()


class ReportIdentityIndex[MetadataT]:
    """Track the one-to-one report/document identity returned across pages."""

    def __init__(self) -> None:
        self._identity_by_report_id: dict[str, tuple[str, MetadataT]] = {}
        self._report_ids_by_document_id: dict[str, set[str]] = {}
        self._conflicting_report_ids: set[str] = set()

    @property
    def conflicting_report_ids(self) -> frozenset[str]:
        """Return every report identity involved in any observed collision."""
        return frozenset(self._conflicting_report_ids)

    def record(
        self,
        *,
        report_id: str,
        report_document_id: str,
        metadata: MetadataT,
    ) -> ReportIdentityCollision | None:
        """Record one identity, returning the collision instead of choosing an error type."""
        report_identity = (report_document_id, metadata)
        first_report_identity = self._identity_by_report_id.get(report_id)
        has_conflicting_metadata = (
            first_report_identity is not None and first_report_identity != report_identity
        )
        self._identity_by_report_id.setdefault(report_id, report_identity)

        document_report_ids = self._report_ids_by_document_id.setdefault(
            report_document_id,
            set(),
        )
        document_report_ids.add(report_id)
        has_reused_document_id = len(document_report_ids) > 1

        if has_conflicting_metadata:
            self._conflicting_report_ids.add(report_id)
        if has_reused_document_id:
            self._conflicting_report_ids.update(document_report_ids)

        if has_conflicting_metadata:
            return ReportIdentityCollision.CONFLICTING_METADATA
        if has_reused_document_id:
            return ReportIdentityCollision.REUSED_DOCUMENT_ID
        return None


def format_reports_datetime(value: datetime) -> str:
    """Format one timezone-aware datetime without narrowing its instant."""
    return as_utc(value).isoformat(timespec="auto").replace("+00:00", "Z")


def marketplace_id_chunks(marketplace_ids: Sequence[str]) -> Iterator[tuple[str, ...]]:
    """Yield non-empty chunks within the Reports API marketplace limit."""
    if not marketplace_ids:
        raise ValueError("At least one marketplace ID is required.")
    values = tuple(marketplace_ids)
    for offset in range(0, len(values), _MAX_MARKETPLACE_IDS_PER_REQUEST):
        yield values[offset : offset + _MAX_MARKETPLACE_IDS_PER_REQUEST]


def iter_report_pages(
    client: ReportsListClient,
    *,
    initial_request: Mapping[str, object],
    max_pages: int,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[ReportsPage]:
    """List bounded pages using only the SDK's token for subsequent requests."""
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("max_pages must be positive.")
    request = dict(initial_request)
    seen_tokens: set[str] = set()
    for _page_number in range(max_pages):
        page = sanitized_throttled_api_call(
            lambda request=request: client.get_reports(**request),
            safe_error=ReportResponseError("Reports API getReports request failed."),
            max_attempts=max_throttle_attempts,
            retry_delay_seconds=throttle_retry_delay_seconds,
            max_retry_after_seconds=max_retry_after_seconds,
            sleep=sleep,
        )
        yield page
        next_token = page.next_token
        if next_token is None:
            return
        if not isinstance(next_token, str) or not next_token.strip():
            raise RuntimeError("Reports API returned an invalid nextToken.")
        if next_token in seen_tokens:
            raise RuntimeError("Reports API repeated nextToken during pagination.")
        seen_tokens.add(next_token)
        request = {"nextToken": next_token}

    raise RuntimeError("Reports API exceeded the configured page bound.")


__all__ = [
    "ReportIdentityCollision",
    "ReportIdentityIndex",
    "format_reports_datetime",
    "iter_report_pages",
    "marketplace_id_chunks",
]
