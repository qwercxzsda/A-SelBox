"""Small native Finances captures for offline behavior verification."""

import json
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from uuid import uuid7

from ...src.archives.storage import archive_document
from ...src.finances.acquisition_models import ArchivedFinancesPage, FinancesAcquisition
from .archives import MemoryArchiveStorage


def native_transaction(
    identifier: str = "A",
    *,
    amount: str = "100",
    status: str = "DEFERRED",
    original: str | None = None,
    release: str | None = None,
    posted: str = "2026-08-01T12:00:00Z",
) -> dict[str, object]:
    related: list[dict[str, str]] = []
    if original:
        related.append(
            {"relatedIdentifierName": "DEFERRED_TRANSACTION_ID", "relatedIdentifierValue": original}
        )
    if release:
        related.append(
            {"relatedIdentifierName": "RELEASE_TRANSACTION_ID", "relatedIdentifierValue": release}
        )
    money = {"currencyAmount": amount, "currencyCode": "USD"}
    return {
        "transactionId": identifier,
        "transactionType": "Shipment",
        "transactionStatus": status,
        "postedDate": posted,
        "totalAmount": money,
        "relatedIdentifiers": related,
        "sellingPartnerMetadata": {
            "sellingPartnerId": "seller-api",
            "marketplaceId": "ATVPDKIKX0DER",
            "accountType": "Standard Orders",
        },
        "items": [
            {
                "totalAmount": money,
                "contexts": [
                    {"contextType": "ProductContext", "sku": "SKU-1", "quantityShipped": 1}
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
        ],
    }


def finances_acquisition(
    storage: MemoryArchiveStorage,
    rows: Sequence[object] = (),
    *,
    end: date = date(2026, 8, 2),
    summary_amount: str | None = None,
    summary_seller: str = "seller-api",
) -> FinancesAcquisition:
    start = date(2026, 8, 1)
    at = datetime(2026, 9, 3, tzinfo=UTC)
    document = archive_document(
        storage,
        json.dumps({"payload": {"transactions": list(rows)}}).encode(),
        source_compression=None,
    )
    request = {
        "postedAfter": "2026-08-01T07:00:00Z",
        "postedBefore": f"{end + timedelta(days=1)}T07:00:00Z",
    }
    pages = [
        ArchivedFinancesPage(
            operation="transactions",
            page_number=1,
            marketplace_id=None,
            is_terminal=True,
            request_parameters=request,
            requested_at=at,
            received_at=at,
            document=document,
        )
    ]
    if summary_amount is not None:
        summary = {
            "partnerMetadata": {
                "partnerId": summary_seller,
                "marketplaceId": "ATVPDKIKX0DER",
                "accountType": "STANDARD_ORDERS",
            },
            "periodStart": start.isoformat(),
            "periodEnd": end.isoformat(),
            "netProceeds": {"currencyAmount": summary_amount, "currencyCode": "USD"},
        }
        archived = archive_document(
            storage, json.dumps({"summaries": [summary]}).encode(), source_compression=None
        )
        pages.append(
            ArchivedFinancesPage(
                operation="summary",
                page_number=1,
                marketplace_id=None,
                is_terminal=True,
                request_parameters={"periodStart": start.isoformat(), "periodEnd": end.isoformat()},
                requested_at=at,
                received_at=at,
                document=archived,
            )
        )
    return FinancesAcquisition(
        id=uuid7(),
        seller_namespace="seller-one",
        amazon_scope="NA",
        api_version="2024-06-19",
        capture_started_at=at,
        downloaded_at=at,
        posted_after=datetime.fromisoformat(request["postedAfter"]),
        posted_before=datetime.fromisoformat(request["postedBefore"]),
        reconciliation_start_date=start,
        reconciliation_end_date=end,
        marketplace_ids=("ATVPDKIKX0DER",),
        documents=tuple(pages),
        api_metadata={
            "summary_available": summary_amount is not None,
            "coverage_marketplaces": [
                {
                    "marketplace_id": "ATVPDKIKX0DER",
                    "marketplace_name": "Amazon.com",
                    "time_zone": "America/Los_Angeles",
                }
            ],
        },
    )
