"""Small authentic-shaped Finances captures shared by archive integration tests."""

import json
from datetime import UTC, date, datetime
from typing import cast
from uuid import uuid7

from services.sync.src.amazon.finances.client import FINANCES_API_VERSION
from services.sync.src.archives.storage import ArchiveStorage, archive_document
from services.sync.src.finances.acquisition_models import (
    ArchivedFinancesPage,
    FinancesAcquisition,
    FinancesCoverageMarketplace,
)
from services.sync.src.finances.query_windows import transaction_query_parameters
from services.sync.src.source_serialization import source_json


def native_transaction(
    amount: int,
    *,
    kind: str = "Shipment",
    sku: str | None = "SKU-1",
    day: str = "2026-08-01",
    identifier: str | None = None,
) -> dict[str, object]:
    money = {"currencyCode": "USD", "currencyAmount": amount}
    path = (
        ("ProductCharges", "OurPricePrincipal")
        if kind in {"Shipment", "Refund"}
        else ("AmazonFees", "FBADisposalFee", "Base")
    )
    breakdown: dict[str, object] = {
        "breakdownType": path[-1],
        "breakdownAmount": money,
        "breakdowns": [],
    }
    for part in reversed(path[:-1]):
        breakdown = {"breakdownType": part, "breakdownAmount": money, "breakdowns": [breakdown]}
    return {
        "transactionId": identifier or str(uuid7()),
        "transactionType": kind,
        "transactionStatus": "RELEASED",
        "postedDate": day + "T12:00:00Z",
        "totalAmount": money,
        "sellingPartnerMetadata": {
            "sellingPartnerId": "test-amazon-seller",
            "marketplaceId": "ATVPDKIKX0DER",
            "accountType": "STANDARD_ORDERS",
        },
        "relatedIdentifiers": [],
        "items": [
            {
                "totalAmount": money,
                "contexts": []
                if sku is None
                else [{"contextType": "ProductContext", "sku": sku, "quantityShipped": 1}],
                "breakdowns": [breakdown],
            }
        ],
    }


def finances_capture(
    storage: ArchiveStorage,
    rows: list[dict[str, object]],
    *,
    seller: str = "seller",
    start: date = date(2026, 8, 1),
    end: date = date(2026, 8, 2),
    observed_at: datetime | None = None,
) -> FinancesAcquisition:
    now = observed_at or datetime.now(UTC)
    market = FinancesCoverageMarketplace("ATVPDKIKX0DER", "Amazon.com", "America/Los_Angeles")
    requests = {
        "transactions": transaction_query_parameters((market,), start, end, observed_at=now),
        "summary": {"periodStart": start.isoformat(), "periodEnd": end.isoformat()},
    }
    total = sum(
        cast(int, cast(dict[str, object], row["totalAmount"])["currencyAmount"]) for row in rows
    )
    bodies = {
        "transactions": {"payload": {"transactions": rows}, "statusCode": 200},
        "summary": {
            "payload": {
                "summaries": [
                    {
                        "partnerMetadata": {
                            "partnerId": "test-amazon-seller",
                            "marketplaceId": market.marketplace_id,
                            "accountType": "STANDARD_ORDERS",
                        },
                        "periodStart": start.isoformat(),
                        "periodEnd": end.isoformat(),
                        "netProceeds": {"currencyCode": "USD", "currencyAmount": total},
                    }
                ]
            },
            "statusCode": 200,
        },
    }
    return FinancesAcquisition(
        id=uuid7(),
        seller_namespace=seller,
        amazon_scope="NA",
        api_version=FINANCES_API_VERSION,
        capture_started_at=now,
        downloaded_at=now,
        query_start_date=start,
        query_end_date=end,
        marketplace_ids=(market.marketplace_id,),
        api_metadata={"coverage_marketplaces": [source_json(market)], "summary_available": True},
        documents=tuple(
            ArchivedFinancesPage(
                operation=operation,
                page_number=1,
                marketplace_id=None,
                is_terminal=True,
                request_parameters=requests[operation],
                requested_at=now,
                received_at=now,
                document=archive_document(
                    storage, json.dumps(bodies[operation]).encode(), source_compression=None
                ),
            )
            for operation in ("transactions", "summary")
        ),
    )
