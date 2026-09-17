"""Small complete archived inputs for offline preprocessing contract tests."""

from datetime import UTC, date, datetime
from uuid import uuid7

from ...src.amazon.data_kiosk.models import DataKioskDocumentKind
from ...src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from ...src.amazon.settlement_models import SettlementReportReference
from ...src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from ...src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
    SettlementAcquisition,
)
from ...src.archives.storage import archive_document
from ...src.numeric import Numeric
from .archives import MemoryArchiveStorage


def settlement_document(
    *rows: dict[str, str], columns: tuple[str, ...] = SETTLEMENT_V2_COLUMNS
) -> bytes:
    metadata = {
        "settlement-id": "settlement-1",
        "settlement-start-date": "2026-08-01T00:00:00Z",
        "settlement-end-date": "2026-08-31T23:59:59Z",
        "deposit-date": "2026-09-02T12:00:00Z",
        "currency": "USD",
        "total-amount": str(sum((Numeric(row.get("amount", "10")) for row in rows), Numeric(0))),
    }
    defaults = {
        "settlement-id": "settlement-1",
        "transaction-type": "Order",
        "amount-type": "ItemPrice",
        "amount-description": "Principal",
        "amount": "10",
        "sku": "SKU-1",
        "marketplace-name": "Amazon.com",
        "posted-date": "2026-08-02",
        "posted-date-time": "2026-08-02T12:00:00Z",
        "quantity-purchased": "1",
    }
    records = [metadata, *({**defaults, **row} for row in rows)]
    return (
        "\t".join(columns)
        + "\n"
        + "\n".join("\t".join(row.get(column, "") for column in columns) for row in records)
        + "\n"
    ).encode()


def settlement_acquisition(document: bytes, storage: MemoryArchiveStorage) -> SettlementAcquisition:
    return SettlementAcquisition(
        id=uuid7(),
        seller_namespace="seller-one",
        amazon_scope="NA",
        reference=SettlementReportReference(
            "report-one", "document-one", datetime(2026, 9, 2, tzinfo=UTC), ("ATVPDKIKX0DER",)
        ),
        downloaded_at=datetime(2026, 9, 3, tzinfo=UTC),
        document=archive_document(storage, document, source_compression=None),
    )


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
        api_metadata={},
    )
