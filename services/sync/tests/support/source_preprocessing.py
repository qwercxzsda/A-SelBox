"""Small complete archived inputs for offline preprocessing contract tests."""

from datetime import UTC, date, datetime
from uuid import uuid7

from ...src.amazon.data_kiosk.models import DataKioskDocumentKind
from ...src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from ...src.archives.models import ArchivedDataKioskPage, DataKioskAcquisition
from ...src.archives.storage import archive_document
from .archives import MemoryArchiveStorage


def kiosk_acquisition(
    storage: MemoryArchiveStorage,
    *documents: bytes | None,
    start_date: date = date(2026, 8, 1),
    end_date: date = date(2026, 8, 2),
) -> DataKioskAcquisition:
    query = build_daily_msku_economics_query(start_date, end_date, "ATVPDKIKX0DER")
    created = datetime(2026, 9, 2, tzinfo=UTC)
    pages: list[ArchivedDataKioskPage] = []
    for index, document in enumerate(documents, 1):
        document_id = f"doc-{index}" if document is not None else None
        metadata: dict[str, object] = {
            "queryId": f"query-{index}",
            "processingStatus": "DONE",
            "query": query,
            "createdTime": created.isoformat(),
        }
        if document_id:
            metadata["dataDocumentId"] = document_id
        if index != len(documents):
            metadata["pagination"] = {"nextToken": f"page-{index + 1}"}
        pages.append(
            ArchivedDataKioskPage(
                page_number=index,
                query_id=f"query-{index}",
                query_created_at=created,
                document_kind=DataKioskDocumentKind.DATA
                if document is not None
                else DataKioskDocumentKind.NO_DATA,
                is_terminal=index == len(documents),
                document_id=document_id,
                api_metadata=metadata,
                document=archive_document(storage, document, source_compression=None)
                if document is not None
                else None,
            )
        )
    return DataKioskAcquisition(
        id=uuid7(),
        seller_namespace="seller-one",
        amazon_scope="NA",
        root_query_id="query-1",
        root_query_created_at=created,
        query_definition=query,
        schema_version=ECONOMICS_SCHEMA_NAME,
        marketplace_id="ATVPDKIKX0DER",
        query_start_date=start_date,
        query_end_date=end_date,
        downloaded_at=created,
        pages=tuple(pages),
        api_metadata=pages[0].api_metadata,
    )
