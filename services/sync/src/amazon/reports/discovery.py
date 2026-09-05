import logging
import time
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from ..api_response_records import direct_payload_records
from ..datetimes import as_utc
from ..marketplaces import validate_marketplace_scope_pair
from ..scopes import validate_amazon_scope
from ..settlement_models import SettlementReportReference
from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
)
from .listing import (
    ReportIdentityIndex,
    format_reports_datetime,
    iter_report_pages,
    marketplace_id_chunks,
)
from .sdk_types import ReportsListClient, ReportsPage
from .summaries import DoneReportSummary, parse_done_report_summary

logger: logging.Logger = logging.getLogger(__name__)

SETTLEMENT_REPORT_TYPE: str = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"
_MAX_PAGES_PER_MARKETPLACE_CHUNK: int = 1000


@dataclass(frozen=True, slots=True)
class _ScopedReportPage:
    """One getReports page bound to the marketplace chunk that produced it."""

    response: ReportsPage
    requested_marketplace_ids: frozenset[str]


@dataclass(frozen=True, slots=True)
class SettlementReportDiscoveryResult:
    """Valid unique reports plus identities quarantined during discovery."""

    reports: tuple[SettlementReportReference, ...]
    identity_anomaly_count: int

    def __post_init__(self) -> None:
        if type(self.identity_anomaly_count) is not int:
            raise TypeError("Settlement identity anomaly count must be an integer.")
        if self.identity_anomaly_count < 0:
            raise ValueError("Settlement identity anomaly count must not be negative.")

    @property
    def listed_count(self) -> int:
        """Count unique report identities assigned a discovery outcome."""
        return len(self.reports) + self.identity_anomaly_count


def discover_settlement_reports(
    client: ReportsListClient,
    *,
    marketplace_ids: Sequence[str],
    amazon_scope: str,
    created_since: datetime,
    created_until: datetime,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> SettlementReportDiscoveryResult:
    """Discover reports while quarantining identity collisions in Python."""
    normalized_scope = validate_amazon_scope(amazon_scope)
    resolved_marketplace_ids = _resolve_marketplace_ids(
        normalized_scope,
        marketplace_ids,
    )
    created_since_at, created_until_at = _validate_discovery_window(
        created_since,
        created_until,
    )

    logger.debug(
        "Listing settlement reports.",
        extra={
            "amazon_scope": normalized_scope,
            "created_since": created_since_at,
            "created_until": created_until_at,
            "marketplace_count": len(resolved_marketplace_ids),
        },
    )
    report_pages = _list_report_pages(
        client,
        resolved_marketplace_ids,
        created_since=created_since_at,
        created_until=created_until_at,
        max_throttle_attempts=max_throttle_attempts,
        throttle_retry_delay_seconds=throttle_retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
        sleep=sleep,
    )
    reports, identity_anomaly_count, page_count = _unique_report_references(
        report_pages,
        created_since_at=created_since_at,
        created_until_at=created_until_at,
    )
    if identity_anomaly_count:
        logger.error(
            "Settlement report identity anomalies found; skipping affected reports.",
            extra={
                "amazon_scope": normalized_scope,
                "identity_anomaly_count": identity_anomaly_count,
            },
        )
    logger.info(
        "Listed settlement reports.",
        extra={
            "amazon_scope": normalized_scope,
            "page_count": page_count,
            "report_count": len(reports),
            "identity_anomaly_count": identity_anomaly_count,
        },
    )
    return SettlementReportDiscoveryResult(
        reports=tuple(reports),
        identity_anomaly_count=identity_anomaly_count,
    )


def _list_report_pages(
    client: ReportsListClient,
    marketplace_ids: list[str],
    *,
    created_since: datetime,
    created_until: datetime,
    max_throttle_attempts: int,
    throttle_retry_delay_seconds: float,
    max_retry_after_seconds: int,
    sleep: Callable[[float], None],
) -> Iterator[_ScopedReportPage]:
    for marketplace_chunk in marketplace_id_chunks(marketplace_ids):
        initial_request: dict[str, object] = {
            "reportTypes": [SETTLEMENT_REPORT_TYPE],
            "processingStatuses": ["DONE"],
            "marketplaceIds": list(marketplace_chunk),
            "createdSince": format_reports_datetime(created_since),
            "createdUntil": format_reports_datetime(created_until),
            "pageSize": 100,
        }
        requested_marketplace_ids = frozenset(marketplace_chunk)
        for page in iter_report_pages(
            client,
            initial_request=initial_request,
            max_pages=_MAX_PAGES_PER_MARKETPLACE_CHUNK,
            max_throttle_attempts=max_throttle_attempts,
            throttle_retry_delay_seconds=throttle_retry_delay_seconds,
            max_retry_after_seconds=max_retry_after_seconds,
            sleep=sleep,
        ):
            yield _ScopedReportPage(page, requested_marketplace_ids)


def _unique_report_references(
    report_pages: Iterable[_ScopedReportPage],
    *,
    created_since_at: datetime,
    created_until_at: datetime,
) -> tuple[list[SettlementReportReference], int, int]:
    summaries_by_report_id: dict[str, DoneReportSummary] = {}
    report_identities: ReportIdentityIndex[DoneReportSummary] = ReportIdentityIndex()
    page_count = 0
    for page in report_pages:
        page_count += 1
        for report in direct_payload_records(
            page.response,
            "reports",
            operation="Reports API getReports",
        ):
            summary = _report_summary(
                report,
                created_since_at=created_since_at,
                created_until_at=created_until_at,
                requested_marketplace_ids=page.requested_marketplace_ids,
            )
            report_identities.record(
                report_id=summary.report_id,
                report_document_id=summary.report_document_id,
                metadata=summary,
            )
            summaries_by_report_id.setdefault(summary.report_id, summary)
    conflicting_report_ids = report_identities.conflicting_report_ids
    return (
        [
            SettlementReportReference(
                report_id=summary.report_id,
                report_document_id=summary.report_document_id,
                report_created_at=summary.created_at,
                marketplace_ids=summary.marketplace_ids,
                report_data_start_at=summary.data_start_at,
                report_data_end_at=summary.data_end_at,
            )
            for report_id, summary in summaries_by_report_id.items()
            if report_id not in conflicting_report_ids
        ],
        len(conflicting_report_ids),
        page_count,
    )


def _report_summary(
    report: Mapping[str, object],
    *,
    created_since_at: datetime,
    created_until_at: datetime,
    requested_marketplace_ids: frozenset[str],
) -> DoneReportSummary:
    summary = parse_done_report_summary(
        report,
        expected_report_types=(SETTLEMENT_REPORT_TYPE,),
    )
    if not created_since_at <= summary.created_at <= created_until_at:
        raise ValueError("Reports API returned a report outside the requested creation window.")
    if frozenset(summary.marketplace_ids).isdisjoint(requested_marketplace_ids):
        raise ValueError("Reports API returned a report outside the request marketplace scope.")
    return summary


def _validate_discovery_window(
    created_since: datetime,
    created_until: datetime,
) -> tuple[datetime, datetime]:
    """Normalize and order one getReports creation-time window."""
    created_since_at = as_utc(created_since)
    created_until_at = as_utc(created_until)
    if created_since_at > created_until_at:
        raise ValueError("created_since must not be after created_until.")
    return created_since_at, created_until_at


def _resolve_marketplace_ids(
    amazon_scope: str,
    marketplace_ids: Sequence[str],
) -> list[str]:
    if isinstance(marketplace_ids, str):
        raise TypeError("marketplace_ids must be a sequence of IDs, not a string.")

    resolved_ids: list[str] = []
    seen_ids: set[str] = set()
    for marketplace_id in marketplace_ids:
        validate_marketplace_scope_pair(amazon_scope, marketplace_id)
        if marketplace_id not in seen_ids:
            resolved_ids.append(marketplace_id)
            seen_ids.add(marketplace_id)
    if not resolved_ids:
        raise ValueError("At least one marketplace ID is required.")
    return resolved_ids


__all__ = [
    "SETTLEMENT_REPORT_TYPE",
    "SettlementReportDiscoveryResult",
    "discover_settlement_reports",
]
