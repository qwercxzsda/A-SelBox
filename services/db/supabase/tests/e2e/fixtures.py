"""Synthetic source documents retained through real archive and database clients."""

import json
import re
from datetime import UTC, date, datetime, timedelta
from uuid import uuid7

from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.amazon.finances.client import FINANCES_API_VERSION, FinancesOperation
from services.sync.src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
)
from services.sync.src.archives.storage import ArchiveStorage, archive_document
from services.sync.src.database.company_terms import (
    FeePeriod,
    create_company,
    publish_sku_terms,
)
from services.sync.src.database.connection import DatabaseConnection
from services.sync.src.finances.acquisition_models import ArchivedFinancesPage, FinancesAcquisition
from services.sync.src.numeric import Numeric
from services.sync.tests.support.economics import complete_economics_document, economics_fee

START = date(2026, 8, 1)
END = date(2026, 8, 2)
CREATED = datetime(2026, 8, 3, 12, tzinfo=UTC)
MARKETPLACE_ID = "ATVPDKIKX0DER"
SKU = "SKU-1"


def fixture_sku(identity: str) -> str:
    """Give independent persistent-stack fixtures globally unique SKU identities."""
    return f"{SKU}-{identity}"


def finances_document(
    identity: str, *, sku: str = SKU, sale_amount: str = "100", quantity: int = 1
) -> bytes:
    """Native Shipment, Refund and SKU-less disposal records, with exact JSON numbers."""
    records: list[dict[str, object]] = []
    amount = Numeric(sale_amount)
    for kind, value, day in (("Shipment", amount, START), ("Refund", -amount, END)):
        money = {"currencyCode": "USD", "currencyAmount": str(value)}
        item = {
            "totalAmount": money,
            "contexts": [
                {"contextType": "ProductContext", "sku": sku, "quantityShipped": quantity}
            ],
            "breakdowns": [
                {
                    "breakdownType": "ProductCharges",
                    "breakdownAmount": money,
                    "breakdowns": [
                        {"breakdownType": "OurPricePrincipal", "breakdownAmount": money}
                    ],
                }
            ],
        }
        records.append(
            {
                "transactionId": f"{identity}-{kind}",
                "transactionType": kind,
                "transactionStatus": "DEFERRED",
                "postedDate": f"{day.isoformat()}T12:00:00Z",
                "sellingPartnerMetadata": {
                    "sellingPartnerId": "synthetic-seller",
                    "marketplaceId": MARKETPLACE_ID,
                    "accountType": "Standard Orders",
                },
                "relatedIdentifiers": [],
                "totalAmount": money,
                "items": [item],
            }
        )
    charge = {"currencyCode": "USD", "currencyAmount": "-10"}
    records.append(
        {
            "transactionId": f"{identity}-disposal",
            "transactionType": "ServiceFee",
            "transactionStatus": "RELEASED",
            "postedDate": f"{END.isoformat()}T12:00:00Z",
            "sellingPartnerMetadata": {
                "sellingPartnerId": "synthetic-seller",
                "marketplaceId": MARKETPLACE_ID,
                "accountType": "Standard Orders",
            },
            "relatedIdentifiers": [],
            "totalAmount": charge,
            "items": [
                {
                    "totalAmount": charge,
                    "breakdowns": [
                        {
                            "breakdownType": "FBAFees",
                            "breakdownAmount": charge,
                            "breakdowns": [
                                {
                                    "breakdownType": "FBADisposalFee",
                                    "breakdownAmount": charge,
                                    "breakdowns": [
                                        {"breakdownType": "Base", "breakdownAmount": charge}
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
        }
    )
    # json.dumps cannot emit Decimal numbers. Only the known money member is
    # unquoted, retaining exact native numeric literals without float conversion.
    body = json.dumps({"payload": {"transactions": records}, "statusCode": 200})
    return re.sub(r'("currencyAmount": )"(-?\d+(?:\.\d+)?)"', r"\1\2", body).encode()


def archived_finances(
    storage: ArchiveStorage,
    seller: str,
    *,
    sku: str | None = None,
    end_date: date = END,
    sale_amount: str = "100",
    quantity: int = 1,
) -> FinancesAcquisition:
    """Archive complete local days and an independent matching Summary response."""
    sku = sku if sku is not None else fixture_sku(seller)
    identifier = uuid7()
    observed = max(CREATED, datetime.combine(end_date, CREATED.timetz()) + timedelta(days=1))
    documents: list[ArchivedFinancesPage] = []
    summary = json.dumps(
        {
            "payload": {
                "summaries": [
                    {
                        "partnerMetadata": {
                            "marketplaceId": MARKETPLACE_ID,
                            "accountType": "Standard Orders",
                        },
                        "periodStart": START.isoformat(),
                        "periodEnd": end_date.isoformat(),
                        "netProceeds": {"currencyCode": "USD", "currencyAmount": -10},
                    }
                ]
            },
            "statusCode": 200,
        }
    ).encode()
    pages: tuple[tuple[FinancesOperation, dict[str, str], bytes], ...] = (
        (
            "transactions",
            {
                "postedAfter": f"{START.isoformat()}T07:00:00+00:00",
                "postedBefore": f"{(end_date + timedelta(days=1)).isoformat()}T07:00:00+00:00",
            },
            finances_document(str(identifier), sku=sku, sale_amount=sale_amount, quantity=quantity),
        ),
        ("summary", {"periodStart": START.isoformat(), "periodEnd": end_date.isoformat()}, summary),
    )
    for operation, parameters, content in pages:
        documents.append(
            ArchivedFinancesPage(
                operation=operation,
                page_number=1,
                marketplace_id=None,
                is_terminal=True,
                request_parameters=parameters,
                requested_at=observed,
                received_at=observed,
                document=archive_document(storage, content, source_compression=None),
            )
        )
    return FinancesAcquisition(
        id=identifier,
        seller_namespace=seller,
        amazon_scope="NA",
        api_version=FINANCES_API_VERSION,
        capture_started_at=observed,
        downloaded_at=observed,
        posted_after=datetime.fromisoformat(pages[0][1]["postedAfter"]),
        posted_before=datetime.fromisoformat(pages[0][1]["postedBefore"]),
        reconciliation_start_date=START,
        reconciliation_end_date=end_date,
        marketplace_ids=(MARKETPLACE_ID,),
        documents=tuple(documents),
        api_metadata={
            "summary_available": True,
            "coverage_marketplaces": [
                {
                    "marketplace_id": MARKETPLACE_ID,
                    "marketplace_name": "Amazon.com",
                    "time_zone": "America/Los_Angeles",
                }
            ],
        },
    )


def archived_data_kiosk(
    storage: ArchiveStorage, seller: str, *, sku: str | None = None, end_date: date = END
) -> DataKioskAcquisition:
    """Two complete pages cover separate days and contribute 12 USD of disposal fees."""
    sku = sku if sku is not None else fixture_sku(seller)
    created = max(CREATED, datetime.combine(end_date, CREATED.timetz()) + timedelta(days=1))
    identifier = uuid7()
    query = build_daily_msku_economics_query(START, end_date, MARKETPLACE_ID)
    pages: list[ArchivedDataKioskPage] = []
    for number, (day, amount) in enumerate(((START, "7"), (END, "5")), start=1):
        query_id = f"query-{identifier}-{number}"
        document_id = f"data-{identifier}-{number}"
        metadata: dict[str, object] = {
            "queryId": query_id,
            "createdTime": created.isoformat(),
            "processingStatus": "DONE",
            "query": query,
            "dataDocumentId": document_id,
        }
        if number == 1:
            metadata["pagination"] = {"nextToken": f"next-{identifier}"}
        fee = economics_fee("DisposalFee", amount=amount, identifier=f"disposal-{identifier}")
        content = complete_economics_document(
            msku=sku,
            start_date=day.isoformat(),
            end_date=day.isoformat(),
            fees="[" + fee.replace(START.isoformat(), day.isoformat()) + "]",
        )
        pages.append(
            ArchivedDataKioskPage(
                page_number=number,
                query_id=query_id,
                query_created_at=created,
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
        root_query_created_at=created,
        query_definition=query,
        schema_version=ECONOMICS_SCHEMA_NAME,
        marketplace_id=MARKETPLACE_ID,
        query_start_date=START,
        query_end_date=end_date,
        downloaded_at=datetime.now(UTC),
        pages=tuple(pages),
        api_metadata=root.api_metadata,
    )


def company_with_fees(database: DatabaseConnection, seller: str, *, sku: str | None = None) -> str:
    """Assign SKU ownership and the 5% sale / 7% refund fee periods."""
    sku = sku if sku is not None else fixture_sku(seller)
    company = create_company(database, f"Local E2E {seller}")
    publish_sku_terms(
        database,
        sku=sku,
        company_id=company,
        expected_current_version_id=None,
        change_reason="Synthetic local end-to-end fixture",
        periods=[
            FeePeriod("Amazon.com", START, END, Numeric(5)),
            FeePeriod("Amazon.com", END, None, Numeric(7)),
        ],
    )
    return company
