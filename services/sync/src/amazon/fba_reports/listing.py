"""Discover completed FBA reports and select exact marketplace coverage."""

import time
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import cast

from sp_api.base import Marketplaces

from ..api_response_records import direct_payload_records
from ..reports.listing import (
    ReportIdentityCollision,
    ReportIdentityIndex,
    format_reports_datetime,
    iter_report_pages,
    marketplace_id_chunks,
)
from ..reports.sdk_types import ReportsListClient
from ..reports.summaries import DoneReportSummary
from .requests import normalize_report_marketplaces, validate_aware_window
from .responses import has_exact_marketplace_scope, parse_done_fba_report

MAX_REPORT_PAGES = 100
_INSTALLED_MARKETPLACE_IDS = frozenset(
    cast(str, marketplace.marketplace_id) for marketplace in Marketplaces
)


def list_done_fba_reports(
    client: ReportsListClient,
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    created_since: datetime,
    created_until: datetime,
    max_pages: int = MAX_REPORT_PAGES,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[DoneReportSummary, ...]:
    """List completed reports with bounded, token-safe pagination."""
    normalized_marketplaces = _validate_report_listing_request(
        report_type=report_type,
        marketplace_ids=marketplace_ids,
        created_since=created_since,
        created_until=created_until,
        max_pages=max_pages,
    )
    references_by_report_id: dict[str, DoneReportSummary] = {}
    report_identities: ReportIdentityIndex[DoneReportSummary] = ReportIdentityIndex()
    for marketplace_chunk in marketplace_id_chunks(normalized_marketplaces):
        initial_request: dict[str, object] = {
            "reportTypes": [report_type],
            "processingStatuses": ["DONE"],
            "marketplaceIds": list(marketplace_chunk),
            "createdSince": format_reports_datetime(created_since),
            "createdUntil": format_reports_datetime(created_until),
            "pageSize": 100,
        }
        for response in iter_report_pages(
            client,
            initial_request=initial_request,
            max_pages=max_pages,
            sleep=sleep,
        ):
            for report_record in direct_payload_records(
                response,
                "reports",
                operation="Reports API getReports",
            ):
                reference = parse_done_fba_report(report_record, report_type)
                if not created_since <= reference.created_at <= created_until:
                    raise RuntimeError(
                        "Reports API returned an FBA report outside the requested creation window."
                    )
                response_marketplace_ids = frozenset(reference.marketplace_ids)
                if response_marketplace_ids.isdisjoint(marketplace_chunk) or not (
                    response_marketplace_ids
                    <= _INSTALLED_MARKETPLACE_IDS.union(normalized_marketplaces)
                ):
                    raise RuntimeError(
                        "Reports API returned an FBA report outside the request marketplace scope."
                    )
                collision = report_identities.record(
                    report_id=reference.report_id,
                    report_document_id=reference.report_document_id,
                    metadata=reference,
                )
                if collision is ReportIdentityCollision.CONFLICTING_METADATA:
                    raise RuntimeError(
                        "Reports API returned conflicting metadata for one FBA report ID."
                    )
                if collision is ReportIdentityCollision.REUSED_DOCUMENT_ID:
                    raise RuntimeError(
                        "Reports API reused one FBA document ID for different reports."
                    )
                references_by_report_id.setdefault(reference.report_id, reference)
    return tuple(sorted(references_by_report_id.values(), key=_report_sort_key, reverse=True))


def select_covering_report(
    reports: Sequence[DoneReportSummary],
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    data_start_at: datetime,
    data_end_at: datetime,
) -> DoneReportSummary | None:
    """Select the newest report with the exact marketplace and period scope."""
    if not report_type.strip():
        raise ValueError("report_type must not be blank.")
    validate_aware_window(data_start_at, data_end_at, context="FBA report data")
    normalized_marketplaces = normalize_report_marketplaces(marketplace_ids)
    candidates = (
        report
        for report in reports
        if report.report_type == report_type
        and has_exact_marketplace_scope(report, normalized_marketplaces)
        and report.data_start_at is not None
        and report.data_end_at is not None
        and report.data_start_at <= data_start_at
        and report.data_end_at >= data_end_at
    )
    return max(candidates, key=_report_sort_key, default=None)


def _validate_report_listing_request(
    *,
    report_type: str,
    marketplace_ids: Sequence[str],
    created_since: datetime,
    created_until: datetime,
    max_pages: int,
) -> tuple[str, ...]:
    if not report_type.strip():
        raise ValueError("report_type must not be blank.")
    validate_aware_window(created_since, created_until, context="FBA report discovery")
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("max_pages must be positive.")
    return normalize_report_marketplaces(marketplace_ids)


def _report_sort_key(report: DoneReportSummary) -> tuple[datetime, str, str]:
    return report.created_at, report.report_id, report.report_document_id


__all__ = ["list_done_fba_reports", "select_covering_report"]
