"""Acquire and archive complete Data Kiosk responses without parsing their bodies."""

from datetime import UTC, date, datetime
from uuid import uuid7

from ..amazon.data_kiosk.client_protocol import DataKioskClient
from ..amazon.data_kiosk.document_decoding import decompress_data_kiosk_document
from ..amazon.data_kiosk.economics_acquisition import iter_economics_document_pages
from ..amazon.data_kiosk.economics_downloads import DownloadedEconomicsPage
from ..amazon.data_kiosk.lifecycle import DEFAULT_MAX_POLL_ATTEMPTS, DEFAULT_POLL_INTERVAL_SECONDS
from ..amazon.data_kiosk.limits import DEFAULT_MAX_DATA_PAGES
from ..amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from ..amazon.datetimes import parse_amazon_datetime
from ..amazon.scopes import validate_amazon_scope
from ..archives.acquisition_logging import AcquisitionLog
from ..archives.models import ArchivedDataKioskPage, DataKioskAcquisition
from ..archives.storage import ArchiveStorage, archive_document
from ..database.acquisitions import persist_data_kiosk_acquisition
from ..database.connection import DatabaseConnection
from ..database.seller_namespaces import validate_seller_namespace
from .query_windows import validate_query_window


def download_data_kiosk_acquisition(
    client: DataKioskClient,
    database: DatabaseConnection,
    storage: ArchiveStorage,
    *,
    seller_namespace: str,
    amazon_scope: str,
    marketplace_id: str,
    query_start_date: date,
    query_end_date: date,
    max_pages: int = DEFAULT_MAX_DATA_PAGES,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
) -> str:
    """Publish only after the terminal API page and every whole archive are saved."""
    with AcquisitionLog(
        "data_kiosk",
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
        query_start_date=query_start_date.isoformat(),
        query_end_date=query_end_date.isoformat(),
    ) as activity:
        validate_amazon_scope(amazon_scope)
        seller_namespace = validate_seller_namespace(seller_namespace)
        validate_query_window(
            marketplace_id, query_start_date, query_end_date, observed_at=datetime.now(UTC)
        )
        query = build_daily_msku_economics_query(query_start_date, query_end_date, marketplace_id)
        pages: list[ArchivedDataKioskPage] = []
        activity.step("download", seller_namespace=seller_namespace, page_number=1)
        for page in iter_economics_document_pages(
            client,
            query,
            max_pages=max_pages,
            max_poll_attempts=max_poll_attempts,
            poll_interval_seconds=poll_interval_seconds,
            on_progress=lambda number, query_id, document_id: activity.step(
                "download", page_number=number, query_id=query_id, document_id=document_id
            ),
        ):
            if not pages:
                activity.context["root_query_id"] = page.query_id
            pages.append(_archive_page(storage, page, activity))
            if not page.is_terminal:
                activity.step(
                    "download",
                    page_number=page.page_number + 1,
                    query_id=None,
                    document_id=None,
                    document_kind=None,
                    is_terminal=None,
                )
        activity.step(
            "manifest_validation",
            page_count=len(pages),
            page_number=None,
            query_id=None,
            document_id=None,
            document_kind=None,
            is_terminal=None,
        )
        if not pages:
            raise ValueError("Data Kiosk returned no terminal acquisition metadata.")
        root = pages[0]
        acquisition = DataKioskAcquisition(
            id=uuid7(),
            seller_namespace=seller_namespace,
            amazon_scope=amazon_scope,
            root_query_id=root.query_id,
            root_query_created_at=root.query_created_at,
            query_definition=query,
            schema_version=ECONOMICS_SCHEMA_NAME,
            marketplace_id=marketplace_id,
            query_start_date=query_start_date,
            query_end_date=query_end_date,
            downloaded_at=datetime.now(UTC),
            pages=tuple(pages),
            api_metadata=root.api_metadata,
        )
        activity.step("publication", candidate_acquisition_id=str(acquisition.id))
        acquisition_id = persist_data_kiosk_acquisition(database, acquisition)
        activity.published(acquisition_id)
        return acquisition_id


def _archive_page(
    storage: ArchiveStorage, page: DownloadedEconomicsPage, activity: AcquisitionLog
) -> ArchivedDataKioskPage:
    activity.step(
        "archive",
        page_number=page.page_number,
        query_id=page.query_id,
        document_id=page.document_id,
        document_kind=page.document_kind.value,
        is_terminal=page.is_terminal,
    )
    created_time = page.api_metadata.get("createdTime")
    if not isinstance(created_time, str):
        raise ValueError("Data Kiosk API metadata omitted its original query creation time.")
    document = None
    if page.document is not None:
        decoded, compression = decompress_data_kiosk_document(page.document)
        document = archive_document(
            storage, decoded, source_compression=compression, acquisition_log=activity
        )
    return ArchivedDataKioskPage(
        page_number=page.page_number,
        query_id=page.query_id,
        query_created_at=parse_amazon_datetime(created_time),
        document_kind=page.document_kind,
        is_terminal=page.is_terminal,
        document_id=page.document_id,
        api_metadata=page.api_metadata,
        document=document,
    )
