"""Shared in-memory archives and source references for behavior tests."""

from datetime import UTC, date, datetime
from unittest.mock import Mock

from services.sync.src.amazon.data_kiosk.economics_downloads import DownloadedEconomicsPage
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.reports.discovery import SETTLEMENT_REPORT_TYPE
from services.sync.src.amazon.settlement_models import SettlementReportReference
from services.sync.src.archives.storage import ArchiveIntegrityError, ArchiveStorage
from services.sync.src.data_kiosk_economics.acquisition import download_data_kiosk_acquisition
from services.sync.src.database.connection import DatabaseConnection

CREATED = datetime(2026, 9, 1, tzinfo=UTC)
ACQUISITION_MODULE = "services.sync.src.data_kiosk_economics.acquisition"
SETTLEMENT_MODULE = "services.sync.src.settlements.download"


class MemoryArchiveStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put(self, bucket: str, object_path: str, content: bytes) -> None:
        key = (bucket, object_path)
        if key in self.objects and self.objects[key] != content:
            raise ArchiveIntegrityError("Object replacement is forbidden.")
        self.objects[key] = content

    def get(self, bucket: str, object_path: str) -> bytes:
        return self.objects[bucket, object_path]


def download_kiosk_acquisition(
    storage: ArchiveStorage,
    *,
    seller_namespace: str = "seller",
    database: DatabaseConnection | None = None,
) -> str:
    """Run acquisition tests with shared scope and mocked Amazon transport."""
    return download_data_kiosk_acquisition(
        Mock(),
        database if database is not None else Mock(),
        storage,
        seller_namespace=seller_namespace,
        amazon_scope="NA",
        marketplace_id="ATVPDKIKX0DER",
        query_start_date=date(2026, 8, 1),
        query_end_date=date(2026, 8, 31),
    )


def page(number: int, *, terminal: bool, content: bytes | None) -> DownloadedEconomicsPage:
    metadata: dict[str, object] = {
        "queryId": f"query-{number}",
        "createdTime": CREATED.isoformat(),
        "processingStatus": "DONE",
        "query": "full query",
    }
    return DownloadedEconomicsPage(
        page_number=number,
        query_id=f"query-{number}",
        document_kind=DataKioskDocumentKind.NO_DATA
        if content is None
        else DataKioskDocumentKind.DATA,
        is_terminal=terminal,
        document_id=f"document-{number}" if content is not None else None,
        document=content,
        api_metadata=metadata,
    )


def settlement_reference(
    marketplace_ids: tuple[str, ...] = ("ATVPDKIKX0DER",),
) -> SettlementReportReference:
    return SettlementReportReference(
        "report",
        "document",
        CREATED,
        marketplace_ids,
        api_metadata={
            "reportId": "report",
            "reportDocumentId": "document",
            "reportType": SETTLEMENT_REPORT_TYPE,
            "processingStatus": "DONE",
            "createdTime": "2026-09-01T00:00:00Z",
            "processingEndTime": "2026-09-01T00:30:00Z",
            "marketplaceIds": list(marketplace_ids),
        },
    )
