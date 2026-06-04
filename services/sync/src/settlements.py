import logging
from pathlib import Path
from tempfile import TemporaryDirectory

from sp_api.api import Reports

from src.amazon import (
    ReportsClientFactory,
    download_recent_settlement_reports,
    parse_settlement_report,
)
from src.amazon.models import DownloadedSettlementReport, ParsedSettlementReport
from src.database import (
    DatabaseConnection,
    insert_settlement_report,
)

logger: logging.Logger = logging.getLogger(__name__)


def sync_settlement_reports(
    client_factory: ReportsClientFactory,
    database: DatabaseConnection,
    days: int,
    output_dir: Path | None,
) -> list[str]:
    """Download, parse, and insert recent settlement reports."""
    log_context: dict[str, int | str] = {
        "amazon_endpoint": client_factory.amazon_endpoint,
        "days": days,
    }
    logger.info("Started settlement report sync.", extra=log_context)

    client: Reports | None = None
    try:
        client = client_factory.create()
        if output_dir is None:
            with TemporaryDirectory() as tmp_dir:
                # Report files are only needed long enough to parse and insert them.
                inserted_settlement_ids: list[str] = sync_downloaded_settlement_reports(
                    client,
                    client_factory.amazon_endpoint,
                    days,
                    Path(tmp_dir),
                    database,
                )
        else:
            inserted_settlement_ids = sync_downloaded_settlement_reports(
                client,
                client_factory.amazon_endpoint,
                days,
                output_dir,
                database,
            )
    except Exception:
        logger.exception("Settlement report sync failed.", extra=log_context)
        raise
    finally:
        if client is not None:
            # The SP-API library may still emit ResourceWarning for internal
            # transports it does not expose through Reports.close().
            client.close()

    logger.info(
        "Finished settlement report sync.",
        extra={
            **log_context,
            "inserted_count": len(inserted_settlement_ids),
        },
    )
    return inserted_settlement_ids


def sync_downloaded_settlement_reports(
    client: Reports,
    amazon_endpoint: str,
    days: int,
    output_dir: Path,
    database: DatabaseConnection,
) -> list[str]:
    """Run the sync workflow with an existing Reports client and explicit paths."""
    downloaded_reports: list[DownloadedSettlementReport] = download_recent_settlement_reports(
        client,
        amazon_endpoint=amazon_endpoint,
        days=days,
        output_dir=output_dir,
    )

    inserted_settlement_ids: list[str] = []
    skipped_duplicate_count: int = 0
    with database as active_database:
        for downloaded_report in downloaded_reports:
            logger.debug(
                "Parsing settlement report document.",
                extra={
                    "amazon_endpoint": amazon_endpoint,
                    "report_id": downloaded_report.report_id,
                    "report_document_id": downloaded_report.report_document_id,
                    "path": str(downloaded_report.path),
                },
            )
            parsed_report: ParsedSettlementReport = parse_settlement_report(
                downloaded_report.path,
                amazon_endpoint=amazon_endpoint,
                report_document_id=downloaded_report.report_document_id,
            )
            settlement_id: str | None = insert_settlement_report(active_database, parsed_report)
            if settlement_id is not None:
                # A non-None ID means the settlement row was newly inserted.
                inserted_settlement_ids.append(settlement_id)
                logger.info(
                    "Inserted settlement report.",
                    extra={
                        "amazon_endpoint": amazon_endpoint,
                        "report_id": downloaded_report.report_id,
                        "report_document_id": downloaded_report.report_document_id,
                        "settlement_id": settlement_id,
                        "amazon_settlement_id": parsed_report.settlement.amz_settlement_id,
                        "transaction_count": len(parsed_report.transactions),
                    },
                )
            else:
                skipped_duplicate_count += 1
                logger.info(
                    "Skipped duplicate settlement report.",
                    extra={
                        "amazon_endpoint": amazon_endpoint,
                        "report_id": downloaded_report.report_id,
                        "report_document_id": downloaded_report.report_document_id,
                        "amazon_settlement_id": parsed_report.settlement.amz_settlement_id,
                    },
                )

    logger.info(
        "Processed settlement report documents.",
        extra={
            "amazon_endpoint": amazon_endpoint,
            "downloaded_count": len(downloaded_reports),
            "inserted_count": len(inserted_settlement_ids),
            "skipped_duplicate_count": skipped_duplicate_count,
        },
    )

    return inserted_settlement_ids


__all__ = [
    "sync_settlement_reports",
]
