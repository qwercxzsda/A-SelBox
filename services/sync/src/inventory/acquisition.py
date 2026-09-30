"""Acquire one full daily report and archive its decoded bytes before publication."""

import time
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid7

from ..amazon.datetimes import parse_amazon_datetime
from ..amazon.marketplaces import get_marketplace_timezone
from ..amazon.reports.decoding import decompress_report_document
from ..amazon.reports.documents import download_report_document
from ..archives.acquisition_logging import AcquisitionLog
from ..archives.storage import ArchiveStorage, archive_document
from ..database.acquisitions import persist_inventory_acquisition
from ..database.connection import DatabaseConnection
from ..database.seller_namespaces import validate_seller_namespace
from .models import InventoryAcquisition, validate_inventory_scope
from .reports import (
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
    InventoryReportsClient,
    request_inventory_report,
    safe_report_metadata,
)
from .serialization import text


def download_inventory_acquisition(
    client: InventoryReportsClient,
    database: DatabaseConnection,
    storage: ArchiveStorage,
    *,
    amazon_scope: str,
    seller_namespace: str,
    marketplace_id: str,
    report_id: str | None = None,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Return the saved acquisition ID without parsing or publishing SKU stock."""
    marketplace_name = validate_inventory_scope(amazon_scope, marketplace_id)
    seller = validate_seller_namespace(seller_namespace)
    with AcquisitionLog(
        "inventory",
        seller_namespace=seller,
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
    ) as activity:
        activity.step("request" if report_id is None else "resume_report")
        report = request_inventory_report(
            client,
            marketplace_id,
            report_id=report_id,
            on_report_id=lambda accepted_id: activity.step("poll_report", report_id=accepted_id),
            max_poll_attempts=max_poll_attempts,
            poll_interval_seconds=poll_interval_seconds,
            sleep=sleep,
        )
        created_at = parse_amazon_datetime(text(report["createdTime"]))
        timezone = get_marketplace_timezone(marketplace_id)
        activity.step("download", report_id=text(report["reportId"]))
        transferred = download_report_document(
            client, text(report["reportDocumentId"]), sleep=sleep
        )
        downloaded_at = datetime.now(UTC)
        activity.step("archive")
        document = archive_document(
            storage,
            decompress_report_document(transferred),
            source_compression=transferred.compression_algorithm,
            acquisition_log=activity,
        )
        activity.step("manifest_validation")
        acquisition = InventoryAcquisition(
            id=uuid7(),
            seller_namespace=seller,
            amazon_scope=amazon_scope,
            marketplace_id=marketplace_id,
            marketplace_name=marketplace_name,
            capture_date=created_at.astimezone(timezone).date(),
            report_id=text(report["reportId"]),
            report_document_id=text(report["reportDocumentId"]),
            report_created_at=created_at,
            downloaded_at=downloaded_at,
            document=document,
            api_metadata={
                "report": safe_report_metadata(report),
                "requested_marketplace_ids": [marketplace_id],
                "capture_timezone": timezone.key,
                "request_mode": "new_report" if report_id is None else "existing_report",
            },
        )
        activity.step("publication", candidate_acquisition_id=str(acquisition.id))
        acquisition_id = persist_inventory_acquisition(database, acquisition)
        activity.published(acquisition_id)
        return acquisition_id
