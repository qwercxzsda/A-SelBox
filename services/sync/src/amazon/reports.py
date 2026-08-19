import logging
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, TypedDict, cast

import sp_api.util as _sp_api_util
from sp_api.api import Reports
from sp_api.base import ApiResponse

from src.amazon.marketplaces import get_endpoint_marketplaces
from src.amazon.models import DownloadedSettlementReport

logger: logging.Logger = logging.getLogger(__name__)

PAGINATION_PARAMETER: str = "nextToken"
SETTLEMENT_REPORT_TYPE: str = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"

type _ApiResponseCallable = Callable[..., ApiResponse]
type _PaginatedApiResponseCallable = Callable[..., Iterable[ApiResponse]]
type _ApiResponseDecorator = Callable[[_ApiResponseCallable], _ApiResponseCallable]
type _PaginationDecorator = Callable[[_ApiResponseCallable], _PaginatedApiResponseCallable]
type _LoadAllPagesFactory = Callable[..., _PaginationDecorator]
type _RetryFactory = Callable[[], _ApiResponseDecorator]


class _ReportSummary(TypedDict):
    reportId: str
    reportDocumentId: str


class _ReportsPayload(TypedDict):
    reports: list[_ReportSummary]


class _ReportsPage(Protocol):
    payload: _ReportsPayload


class _TypedReportsClient(Protocol):
    def get_reports(self, **kwargs: object) -> ApiResponse:
        """Call the dynamically typed Reports listing endpoint."""
        ...

    def get_report_document(
        self,
        report_document_id: str,
        *,
        download: bool,
        file: str,
    ) -> ApiResponse:
        """Call the dynamically typed report-document endpoint."""
        ...


# python-amazon-sp-api does not publish complete callable annotations. Cast its
# decorator factories once at this boundary so unknown types do not leak inward.
_load_all_pages: _LoadAllPagesFactory = cast(
    _LoadAllPagesFactory,
    vars(_sp_api_util)["load_all_pages"],
)
_sp_retry: _RetryFactory = cast(
    _RetryFactory,
    vars(_sp_api_util)["sp_retry"],
)


def get_created_since(days: int) -> str:
    """Return the Reports API createdSince timestamp for the recent-day window."""
    if days < 1:
        raise ValueError("days must be greater than or equal to 1.")

    return (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def list_settlement_report_documents(
    client: Reports,
    amazon_endpoint: str,
    days: int,
) -> list[tuple[str, str]]:
    """List completed settlement report IDs and document IDs."""
    typed_client: _TypedReportsClient = cast(_TypedReportsClient, client)
    marketplace_ids: list[str] = [
        marketplace.marketplace_id for marketplace in get_endpoint_marketplaces(amazon_endpoint)
    ]
    created_since: str = get_created_since(days)

    logger.debug(
        "Listing settlement reports.",
        extra={
            "amazon_endpoint": amazon_endpoint,
            "days": days,
            "created_since": created_since,
            "marketplace_count": len(marketplace_ids),
        },
    )

    # Reports API pagination sends only nextToken after the first request.
    def iter_reports(**kwargs: object) -> ApiResponse:
        """Fetch one page of reports with retry behavior."""
        return typed_client.get_reports(**kwargs)

    paginated_iter_reports: _PaginatedApiResponseCallable = _load_all_pages(
        next_token_param=PAGINATION_PARAMETER,
        next_token_only=True,
    )(_sp_retry()(iter_reports))
    report_pages: list[ApiResponse] = list(
        paginated_iter_reports(
            reportTypes=[SETTLEMENT_REPORT_TYPE],
            processingStatuses=["DONE"],
            marketplaceIds=marketplace_ids,
            createdSince=created_since,
            pageSize=100,
        )
    )

    report_documents: list[tuple[str, str]] = []
    for page in report_pages:
        typed_page: _ReportsPage = cast(_ReportsPage, page)
        for report in typed_page.payload.get("reports", []):
            report_documents.append((report["reportId"], report["reportDocumentId"]))

    logger.info(
        "Listed settlement reports.",
        extra={
            "amazon_endpoint": amazon_endpoint,
            "days": days,
            "page_count": len(report_pages),
            "report_count": len(report_documents),
        },
    )

    return report_documents


def download_report_document(
    client: Reports, report_document_id: str, output_path: Path
) -> ApiResponse:
    """Download one report document to a local TSV path."""
    typed_client: _TypedReportsClient = cast(_TypedReportsClient, client)
    document_response: ApiResponse = typed_client.get_report_document(
        report_document_id,
        download=True,
        file=str(output_path),
    )

    logger.debug(
        "Downloaded settlement report document.",
        extra={
            "report_document_id": report_document_id,
            "output_path": str(output_path),
        },
    )
    return document_response


def download_recent_settlement_reports(
    client: Reports,
    amazon_endpoint: str,
    days: int,
    output_dir: Path,
) -> list[DownloadedSettlementReport]:
    """Download recent completed settlement reports into the output directory."""
    report_documents: list[tuple[str, str]] = list_settlement_report_documents(
        client,
        amazon_endpoint=amazon_endpoint,
        days=days,
    )

    output_dir.mkdir(parents=True, exist_ok=True)

    downloaded_reports: list[DownloadedSettlementReport] = []
    for report_id, report_document_id in report_documents:
        # The downloaded file is temporary; the report document ID is what we persist.
        output_path: Path = output_dir / f"{report_id}.tsv"
        download_report_document(client, report_document_id, output_path)
        downloaded_reports.append(
            DownloadedSettlementReport(
                report_id=report_id,
                report_document_id=report_document_id,
                path=output_path,
            )
        )

    logger.info(
        "Downloaded settlement report documents.",
        extra={
            "amazon_endpoint": amazon_endpoint,
            "days": days,
            "report_count": len(downloaded_reports),
            "output_dir": str(output_dir),
        },
    )

    return downloaded_reports
