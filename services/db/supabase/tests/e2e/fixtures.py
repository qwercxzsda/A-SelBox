"""Synthetic source documents retained through real archive and database clients."""

from datetime import UTC, date, datetime
from uuid import uuid7

from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.amazon.reports.discovery import SETTLEMENT_REPORT_TYPE
from services.sync.src.amazon.settlement_models import SettlementReportReference
from services.sync.src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from services.sync.src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
    SettlementAcquisition,
)
from services.sync.src.archives.storage import ArchiveStorage, archive_document
from services.sync.src.database.company_terms import (
    FeePeriod,
    create_company,
    publish_sku_terms,
)
from services.sync.src.database.connection import DatabaseConnection
from services.sync.src.numeric import Numeric
from services.sync.tests.support.economics import complete_economics_document, economics_fee

START = date(2026, 8, 1)
END = date(2026, 8, 2)
CREATED = datetime(2026, 8, 3, 12, tzinfo=UTC)
MARKETPLACE_ID = "ATVPDKIKX0DER"
SKU = "SKU-1"


def settlement_document(identity: str) -> bytes:
    """A 100 USD sale, full refund, and account-level disposal reconciliation."""
    rows = [
        {
            "settlement-id": identity,
            "settlement-start-date": "2026-08-01T00:00:00Z",
            "settlement-end-date": "2026-08-02T23:59:59Z",
            "deposit-date": "2026-08-03T00:00:00Z",
            "total-amount": "-10",
            "currency": "USD",
        }
    ]
    for transaction, amount, day in (("Order", "100", START), ("Refund", "-100", END)):
        rows.append(
            {
                "settlement-id": identity,
                "transaction-type": transaction,
                "order-id": f"order-{identity}",
                "marketplace-name": "Amazon.com",
                "amount-type": "ItemPrice",
                "amount-description": "Principal",
                "amount": amount,
                "posted-date": day.isoformat(),
                "posted-date-time": f"{day.isoformat()}T12:00:00Z",
                "sku": SKU,
                "quantity-purchased": "1",
            }
        )
    rows.append(
        {
            "settlement-id": identity,
            "transaction-type": "FBAFees",
            "amount-type": "FBA Removal Order: Disposal Fee",
            "amount-description": "Base fee",
            "amount": "-10",
            "posted-date": END.isoformat(),
            "posted-date-time": f"{END.isoformat()}T12:00:00Z",
            "sku": "",
        }
    )
    lines = ["\t".join(SETTLEMENT_V2_COLUMNS)]
    lines.extend("\t".join(row.get(column, "") for column in SETTLEMENT_V2_COLUMNS) for row in rows)
    return ("\r\n".join(lines) + "\r\n").encode()


def archived_settlement(storage: ArchiveStorage, seller: str) -> SettlementAcquisition:
    """Upload a real immutable archive and retain complete Reports provenance."""
    identifier = uuid7()
    report_id = f"report-{identifier}"
    document_id = f"document-{identifier}"
    metadata: dict[str, object] = {
        "reportId": report_id,
        "reportDocumentId": document_id,
        "reportType": SETTLEMENT_REPORT_TYPE,
        "processingStatus": "DONE",
        "createdTime": CREATED.isoformat(),
        "marketplaceIds": [MARKETPLACE_ID],
    }
    return SettlementAcquisition(
        id=identifier,
        seller_namespace=seller,
        amazon_scope="NA",
        reference=SettlementReportReference(
            report_id, document_id, CREATED, (MARKETPLACE_ID,), api_metadata=metadata
        ),
        downloaded_at=datetime.now(UTC),
        document=archive_document(
            storage,
            settlement_document(str(identifier)),
            source_compression=None,
        ),
        api_metadata=metadata,
    )


def archived_data_kiosk(storage: ArchiveStorage, seller: str) -> DataKioskAcquisition:
    """Two complete pages cover separate days and contribute 12 USD of disposal fees."""
    identifier = uuid7()
    query = build_daily_msku_economics_query(START, END, MARKETPLACE_ID)
    pages: list[ArchivedDataKioskPage] = []
    for number, (day, amount) in enumerate(((START, "7"), (END, "5")), start=1):
        query_id = f"query-{identifier}-{number}"
        document_id = f"data-{identifier}-{number}"
        metadata: dict[str, object] = {
            "queryId": query_id,
            "createdTime": CREATED.isoformat(),
            "processingStatus": "DONE",
            "query": query,
            "dataDocumentId": document_id,
        }
        if number == 1:
            metadata["pagination"] = {"nextToken": f"next-{identifier}"}
        fee = economics_fee("DisposalFee", amount=amount, identifier=f"disposal-{identifier}")
        content = complete_economics_document(
            msku=SKU,
            start_date=day.isoformat(),
            end_date=day.isoformat(),
            fees="[" + fee.replace(START.isoformat(), day.isoformat()) + "]",
        )
        pages.append(
            ArchivedDataKioskPage(
                page_number=number,
                query_id=query_id,
                query_created_at=CREATED,
                document_kind=DataKioskDocumentKind.DATA,
                is_terminal=number == 2,
                document_id=document_id,
                document=archive_document(storage, content, source_compression=None),
                api_metadata=metadata,
            )
        )
    root = pages[0]
    return DataKioskAcquisition(
        id=identifier,
        seller_namespace=seller,
        amazon_scope="NA",
        root_query_id=root.query_id,
        root_query_created_at=CREATED,
        query_definition=query,
        schema_version=ECONOMICS_SCHEMA_NAME,
        marketplace_id=MARKETPLACE_ID,
        query_start_date=START,
        query_end_date=END,
        downloaded_at=datetime.now(UTC),
        pages=tuple(pages),
        api_metadata=root.api_metadata,
    )


def company_with_fees(database: DatabaseConnection, seller: str) -> str:
    """Assign SKU ownership and the 5% sale / 7% refund fee periods."""
    company = create_company(database, f"Local E2E {seller}")
    publish_sku_terms(
        database,
        seller_namespace=seller,
        sku=SKU,
        company_id=company,
        expected_current_version_id=None,
        change_reason="Synthetic local end-to-end fixture",
        periods=[
            FeePeriod("Amazon.com", START, END, Numeric(5)),
            FeePeriod("Amazon.com", END, None, Numeric(7)),
        ],
    )
    return company
