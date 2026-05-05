import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from sp_api.api import Reports
from sp_api.base import ApiResponse, Marketplaces
from sp_api.util import load_all_pages, sp_retry

logger: logging.Logger = logging.getLogger(__name__)

load_dotenv()


if __name__ == "__main__":
    # Set up logging
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__).parent / f"{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )
    sh: logging.StreamHandler = logging.StreamHandler()

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

    # Settlement reports는 보통 자동 생성되므로 최근 90일 이내 생성된 report를 검색.
    # Reports API 문서상 createdSince 기본값도 90일 전이고, report 보관도 보통 최대 90일 범위로 다뤄진다.
    # 우리는 가장 최근 report 하나만 필요하므로 최근 60일만 검색한다.
    created_since: str = (datetime.now(UTC) - timedelta(days=60)).strftime(
        "%Y-%m-%dT%H:%M:%S.%fZ"
    )

    @load_all_pages(next_token_param="nextToken", next_token_only=True)
    @sp_retry()
    def iter_reports(**kwargs):
        return client.get_reports(**kwargs)

    report_pages: list[ApiResponse] = list(
        iter_reports(
            reportTypes=["GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"],
            processingStatuses=["DONE"],
            marketplaceIds=[Marketplaces.ES.marketplace_id],
            createdSince=created_since,
            pageSize=100,
        )
    )

    for i, page in enumerate(report_pages):
        logger.info(f"{i}th report page: {page.payload}")

    j: int = 0
    for page in report_pages:
        for report in page.payload.get("reports", []):
            logger.info(f"{j}th report: {report}")
            j += 1
