import logging
import os
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, TextIO, TypedDict, cast

import sp_api.util as _sp_api_util
from dotenv import load_dotenv
from sp_api.api import Reports
from sp_api.base import ApiResponse, Marketplaces

logger: logging.Logger = logging.getLogger(__name__)

PAGINATION_PARAMETER: str = "nextToken"

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


_load_all_pages: _LoadAllPagesFactory = cast(
    _LoadAllPagesFactory,
    vars(_sp_api_util)["load_all_pages"],
)
_sp_retry: _RetryFactory = cast(
    _RetryFactory,
    vars(_sp_api_util)["sp_retry"],
)

load_dotenv()


def download_report_document(
    client: Reports, report_document_id: str, output_path: Path
) -> ApiResponse:
    """Download a report document and save it to the specified output path.

    Args:
        client (Reports): An instance of the Reports API client.
        report_document_id (str): The ID of the report document to download.
        output_path (Path): The path where the downloaded report should be saved.

    Returns:
        ApiResponse: The response from the get_report_document API call.
    """
    typed_client: _TypedReportsClient = cast(_TypedReportsClient, client)
    document_response: ApiResponse = typed_client.get_report_document(
        report_document_id,
        download=True,
        file=str(output_path),
    )

    logger.info("Report document response: %s", document_response)
    logger.info("Downloaded settlement report to: %s", output_path)
    return document_response


if __name__ == "__main__":
    # Set up logging
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__).parent / f"{datetime.now(UTC).strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )
    sh: logging.StreamHandler[TextIO] = logging.StreamHandler()

    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.INFO,
        handlers=[fh, sh],
    )

    client: Reports = Reports(
        marketplace=Marketplaces.ES,
        refresh_token=os.getenv("REFRESH_TOKEN_EU"),
    )
    typed_client: _TypedReportsClient = cast(_TypedReportsClient, client)

    # Settlement reports는 보통 자동 생성되므로 최근 90일 이내 생성된 report를 검색.
    # Reports API 문서상 createdSince 기본값도 90일 전이고,
    # report 보관도 보통 최대 90일 범위로 다뤄진다.
    # 우리는 가장 최근 report 하나만 필요하므로 최근 60일만 검색한다.
    created_since_datetime: datetime = datetime.now(UTC) - timedelta(days=60)
    created_since: str = created_since_datetime.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    def iter_reports(**kwargs: object) -> ApiResponse:
        return typed_client.get_reports(**kwargs)

    paginated_iter_reports: _PaginatedApiResponseCallable = _load_all_pages(
        next_token_param=PAGINATION_PARAMETER,
        next_token_only=True,
    )(_sp_retry()(iter_reports))
    report_pages: list[ApiResponse] = list(
        paginated_iter_reports(
            reportTypes=["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"],
            processingStatuses=["DONE"],
            marketplaceIds=[Marketplaces.ES.marketplace_id],
            createdSince=created_since,
            pageSize=100,
        )
    )

    for i, page in enumerate(report_pages):
        typed_page: _ReportsPage = cast(_ReportsPage, page)
        logger.info("Report page %s: %s", i, typed_page.payload)

    report_id_document_id: list[tuple[str, str]] = []
    j: int = 0
    for page in report_pages:
        typed_page = cast(_ReportsPage, page)
        for report in typed_page.payload.get("reports", []):
            logger.info("Report %s: %s", j, report)
            report_id_document_id.append((report["reportId"], report["reportDocumentId"]))
            j += 1

    output_dir = Path(__file__).parent / "settlement_reports"
    output_dir.mkdir(exist_ok=True)

    for report_id, report_document_id in report_id_document_id:
        output_path: Path = output_dir / f"{report_id}.tsv"
        download_report_document(client, report_document_id, output_path)
