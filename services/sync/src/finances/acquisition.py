"""Archive complete regional Finances pages before publishing offline input."""

import json
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from uuid import uuid7

from ..amazon.finances.client import FINANCES_API_VERSION, FinancesClient, FinancesOperation
from ..amazon.scopes import validate_amazon_scope
from ..archives.acquisition_logging import AcquisitionLog
from ..archives.storage import ArchiveStorage, archive_document
from ..seller_namespaces import validate_seller_namespace
from ..source_serialization import source_json
from .acquisition_models import (
    ArchivedFinancesPage,
    FinancesAcquisition,
    FinancesCoverageMarketplace,
    validate_coverage_scope,
)
from .query_windows import reconciliation_interval, transaction_query_parameters
from .values import continuation_token, decode_page

DEFAULT_MAX_FINANCES_PAGES = 1000
_LOG = logging.getLogger(__name__)


def download_finances_acquisition(
    client: FinancesClient,
    storage: ArchiveStorage,
    *,
    seller_namespace: str,
    amazon_scope: str,
    marketplaces: Sequence[FinancesCoverageMarketplace],
    posted_after: datetime,
    posted_before: datetime | None = None,
    max_pages: int = DEFAULT_MAX_FINANCES_PAGES,
) -> FinancesAcquisition:
    """Archive a regional capture and return its local offline input manifest.

    Summary is an independent control. A failed Summary download leaves the
    transaction acquisition available for offline review, with an explicit
    unavailable control; it cannot establish reconciliation or payout readiness.
    """
    seller = validate_seller_namespace(seller_namespace)
    scope = validate_amazon_scope(amazon_scope)
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("Finances page limit must be a positive integer.")
    if len({market.marketplace_id for market in marketplaces}) != len(marketplaces):
        raise ValueError("Finances coverage marketplaces must be unique.")
    validate_coverage_scope(scope, tuple(marketplaces))
    with AcquisitionLog(
        "finances",
        seller_namespace=seller,
        amazon_scope=scope,
        posted_after=posted_after.isoformat(),
        posted_before=posted_before.isoformat() if posted_before is not None else None,
    ) as activity:
        started = datetime.now(UTC)
        identifier = uuid7()
        activity.context["candidate_acquisition_id"] = str(identifier)
        parameters = transaction_query_parameters(posted_after, posted_before, observed_at=started)
        reconciliation_start, reconciliation_end = reconciliation_interval(
            marketplaces, posted_after, posted_before, observed_at=started
        )
        documents = _download_pages(
            client, storage, "transactions", parameters, max_pages, activity
        )
        summary_pages = _download_summary(
            client, storage, reconciliation_start, reconciliation_end, max_pages, activity
        )
        documents.extend(summary_pages)
        activity.step("manifest_validation", page_number=None, operation=None)
        acquisition = FinancesAcquisition(
            id=identifier,
            seller_namespace=seller,
            amazon_scope=scope,
            api_version=FINANCES_API_VERSION,
            capture_started_at=started,
            downloaded_at=datetime.now(UTC),
            posted_after=posted_after,
            posted_before=posted_before,
            reconciliation_start_date=reconciliation_start,
            reconciliation_end_date=reconciliation_end,
            marketplace_ids=tuple(m.marketplace_id for m in marketplaces),
            documents=tuple(documents),
            api_metadata={
                "coverage_marketplaces": [source_json(m) for m in marketplaces],
                "summary_available": bool(summary_pages),
            },
        )
        activity.step("archive_complete")
        return acquisition


def _download_summary(
    client: FinancesClient,
    storage: ArchiveStorage,
    start: date | None,
    end: date | None,
    max_pages: int,
    activity: AcquisitionLog,
) -> list[ArchivedFinancesPage]:
    if start is None or end is None:
        return []
    archive_start = len(activity.verified_archives)
    try:
        return _download_pages(
            client,
            storage,
            "summary",
            {"periodStart": start.isoformat(), "periodEnd": end.isoformat()},
            max_pages,
            activity,
        )
    except Exception as error:
        _LOG.warning("Finances Summary unavailable [exception_type=%s].", type(error).__name__)
        for archive in activity.verified_archives[archive_start:]:
            _LOG.warning("Finances incomplete Summary archive retained: %s", json.dumps(archive))
        if activity.pending_archive is not None:
            _LOG.warning(
                "Finances Summary archive upload unconfirmed: %s",
                json.dumps(activity.pending_archive),
            )
        activity.step("summary_unavailable")
        return []


def _download_pages(
    client: FinancesClient,
    storage: ArchiveStorage,
    operation: FinancesOperation,
    parameters: Mapping[str, str],
    max_pages: int,
    activity: AcquisitionLog,
) -> list[ArchivedFinancesPage]:
    pages: list[ArchivedFinancesPage] = []
    seen_tokens: set[str] = set()
    token: str | None = None
    for page_number in range(1, max_pages + 1):
        request = dict(parameters)
        if token is not None:
            request["nextToken"] = token
        activity.step("download", operation=operation, page_number=page_number)
        response = client.get_page(operation, request)
        activity.step("archive")
        document = archive_document(
            storage, response.content, source_compression=None, acquisition_log=activity
        )
        # Even malformed source JSON remains archived before parsing is attempted.
        token = continuation_token(decode_page(response.content, operation))
        if token is not None and token in seen_tokens:
            raise ValueError("Finances pagination repeated a continuation token.")
        if token is not None:
            seen_tokens.add(token)
        pages.append(
            ArchivedFinancesPage(
                operation=operation,
                page_number=page_number,
                marketplace_id=None,
                is_terminal=token is None,
                request_parameters=request,
                requested_at=response.requested_at,
                received_at=response.received_at,
                document=document,
                api_metadata={"request_id": response.request_id}
                if response.request_id is not None
                else {},
            )
        )
        if token is None:
            return pages
    raise ValueError("Finances pagination exceeded the configured page limit.")
