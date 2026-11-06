"""Archive complete regional Finances pages before publishing offline input."""

import json
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import cast
from uuid import uuid7

from ..amazon.finances.client import FINANCES_API_VERSION, FinancesClient, FinancesOperation
from ..amazon.scopes import validate_amazon_scope
from ..archives.acquisition_logging import AcquisitionLog
from ..archives.storage import ArchiveStorage, archive_document
from ..database.seller_namespaces import validate_seller_namespace
from ..source_serialization import source_json
from .acquisition_models import (
    ArchivedFinancesPage,
    FinancesAcquisition,
    FinancesCoverageMarketplace,
    validate_coverage_scope,
)
from .query_windows import transaction_query_parameters

DEFAULT_MAX_FINANCES_PAGES = 1000
_LOG = logging.getLogger(__name__)


def download_finances_acquisition(
    client: FinancesClient,
    storage: ArchiveStorage,
    *,
    seller_namespace: str,
    amazon_scope: str,
    marketplaces: Sequence[FinancesCoverageMarketplace],
    query_start_date: date,
    query_end_date: date,
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
    if (query_start_date.year, query_start_date.month) != (
        query_end_date.year,
        query_end_date.month,
    ):
        raise ValueError("Finances acquisitions must remain within one calendar month.")
    if len({market.marketplace_id for market in marketplaces}) != len(marketplaces):
        raise ValueError("Finances coverage marketplaces must be unique.")
    validate_coverage_scope(scope, tuple(marketplaces))
    with AcquisitionLog(
        "finances",
        seller_namespace=seller,
        amazon_scope=scope,
        query_start_date=query_start_date.isoformat(),
        query_end_date=query_end_date.isoformat(),
    ) as activity:
        started = datetime.now(UTC)
        identifier = uuid7()
        activity.context["candidate_acquisition_id"] = str(identifier)
        parameters = transaction_query_parameters(
            marketplaces, query_start_date, query_end_date, observed_at=started
        )
        documents = _download_pages(
            client, storage, "transactions", parameters, max_pages, activity
        )
        summary_available = False
        summary_archive_start = len(activity.verified_archives)
        try:
            summary_pages = _download_pages(
                client,
                storage,
                "summary",
                {
                    "periodStart": query_start_date.isoformat(),
                    "periodEnd": query_end_date.isoformat(),
                },
                max_pages,
                activity,
            )
        except Exception as error:
            _LOG.warning("Finances Summary unavailable [exception_type=%s].", type(error).__name__)
            for archive in activity.verified_archives[summary_archive_start:]:
                _LOG.warning(
                    "Finances incomplete Summary archive retained: %s", json.dumps(archive)
                )
            if activity.pending_archive is not None:
                _LOG.warning(
                    "Finances Summary archive upload unconfirmed: %s",
                    json.dumps(activity.pending_archive),
                )
            activity.step("summary_unavailable")
        else:
            documents.extend(summary_pages)
            summary_available = True
        activity.step("manifest_validation", page_number=None, operation=None)
        acquisition = FinancesAcquisition(
            id=identifier,
            seller_namespace=seller,
            amazon_scope=scope,
            api_version=FINANCES_API_VERSION,
            capture_started_at=started,
            downloaded_at=datetime.now(UTC),
            query_start_date=query_start_date,
            query_end_date=query_end_date,
            marketplace_ids=tuple(m.marketplace_id for m in marketplaces),
            documents=tuple(documents),
            api_metadata={
                "coverage_marketplaces": [source_json(m) for m in marketplaces],
                "summary_available": summary_available,
            },
        )
        activity.step("archive_complete")
        return acquisition


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
        token = _next_token(response.content, operation)
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


def _next_token(content: bytes, operation: FinancesOperation) -> str | None:
    decoded: object = json.loads(content, parse_float=Decimal)
    if not isinstance(decoded, dict):
        raise ValueError("Finances response must be a JSON object.")
    envelope = cast(dict[str, object], decoded)
    # Finances' published Summary model is direct-root, while the live service
    # also wraps it in payload/statusCode. Preserve either exact HTTP form.
    payload = (
        envelope.get("payload", envelope) if operation == "summary" else envelope.get("payload")
    )
    if not isinstance(payload, dict):
        raise ValueError("Finances response is missing its payload.")
    body = cast(dict[str, object], payload)
    if not isinstance(
        body.get("transactions" if operation == "transactions" else "summaries"), list
    ):
        raise ValueError("Finances response is missing its record inventory.")
    token = body.get("nextToken")
    if token is not None and (not isinstance(token, str) or not token.strip()):
        raise ValueError("Finances continuation token must be nonempty text or null.")
    return token
