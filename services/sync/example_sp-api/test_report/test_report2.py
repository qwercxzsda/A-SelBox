import logging
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from sp_api.api import Reports
from sp_api.base import ApiResponse, Marketplaces

logger: logging.Logger = logging.getLogger(__name__)

load_dotenv()


def download_report_document(
    client: Reports, report_document_id: str, output_dir: Path
) -> ApiResponse:
    """
    Downloads the report document using the provided client and saves it to the specified output directory.

    Args:
        client (Reports): An instance of the Reports API client.
        report_document_id (str): The ID of the report document to download.
        output_dir (Path): The directory where the downloaded report should be saved.

    Returns:
        ApiResponse: The response from the get_report_document API call.
    """
    report_path: Path = output_dir / f"{report_document_id}.tsv"
    document_response: ApiResponse = client.get_report_document(
        report_document_id,
        download=True,
        file=str(report_path),
    )

    logger.info(f"Report document response: {document_response}")
    logger.info(f"Downloaded settlement report to: {report_path}")
    return document_response


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

    report_document_id: str = (
        "amzn1.spdoc.1.4.eu.7ae5240d-018e-42b7-ba43-9eba0030b807.T3LFGU9AGPAKW8.1118"
    )

    output_dir = Path(__file__).parent / "settlement_reports"
    output_dir.mkdir(exist_ok=True)

    document_response: ApiResponse = download_report_document(
        client, report_document_id, output_dir
    )
"""
    # TSV 파싱
    rows: list[dict[str, str]] = []

    # V2 settlement report는 tab-delimited flat file
    with raw_report_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            rows.append(row)

    logger.info(f"Parsed rows: {len(rows)}")

    for i, row in enumerate(rows[:10]):
        logger.info(f"{i}th settlement row: {row}")

    logger.info(f"Total settlement rows: {len(rows)}")
"""
