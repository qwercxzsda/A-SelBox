"""Fixtures for Workflow B unit tests."""

from uuid import UUID

from ...src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from ...src.settlement_processing.models import StoredSettlementReport, StoredSettlementRow

SETTLEMENT_REPORT_ID = str(UUID(int=101))
ORDER_ROW_ID = str(UUID(int=102))
REFUND_ROW_ID = str(UUID(int=103))
MARKETPLACE_ID = "ATVPDKIKX0DER"
MARKETPLACE_NAME = "Amazon.com"


def stored_settlement_report() -> StoredSettlementReport:
    """Return one report whose $10 sale and $2 refund settle to $8."""
    columns = SETTLEMENT_V2_COLUMNS
    metadata = _values(
        {
            "settlement-id": "settlement-1",
            "settlement-start-date": "2026-08-01T00:00:00Z",
            "settlement-end-date": "2026-08-15T23:59:59Z",
            "deposit-date": "2026-08-17T00:00:00Z",
            "total-amount": "8.00",
            "currency": "USD",
        }
    )
    order = _values(
        {
            "settlement-id": "settlement-1",
            "transaction-type": "Order",
            "order-id": "111-0000000-0000001",
            "marketplace-name": MARKETPLACE_NAME,
            "amount-type": "ItemPrice",
            "amount-description": "Principal",
            "amount": "10.00",
            "posted-date": "2026-08-02",
            "posted-date-time": "2026-08-02T12:00:00Z",
            "order-item-code": "item-1",
            "sku": "SKU-1",
            "quantity-purchased": "1",
        }
    )
    refund = _values(
        {
            "settlement-id": "settlement-1",
            "transaction-type": "Refund",
            "order-id": "111-0000000-0000001",
            "marketplace-name": MARKETPLACE_NAME,
            "amount-type": "ItemPrice",
            "amount-description": "Principal",
            "amount": "-2.00",
            "posted-date": "2026-08-02",
            "posted-date-time": "2026-08-02T13:00:00Z",
            "order-item-code": "item-1",
            "sku": "SKU-1",
            "quantity-purchased": "1",
        }
    )
    return StoredSettlementReport(
        id=SETTLEMENT_REPORT_ID,
        seller_namespace="seller-na",
        amazon_scope="NA",
        marketplace_ids=(MARKETPLACE_ID,),
        marketplace_names=(MARKETPLACE_NAME,),
        columns=columns,
        metadata_values=metadata,
        rows=(
            StoredSettlementRow(ORDER_ROW_ID, 3, order),
            StoredSettlementRow(REFUND_ROW_ID, 4, refund),
        ),
    )


def stored_report_database_rows() -> tuple[tuple[object, ...], list[tuple[object, ...]]]:
    report = stored_settlement_report()
    report_row: tuple[object, ...] = (
        report.id,
        report.seller_namespace,
        report.amazon_scope,
        list(report.marketplace_ids),
        list(report.marketplace_names),
        list(report.columns),
        list(report.metadata_values),
        len(report.rows),
    )
    content_rows: list[tuple[object, ...]] = [
        (row.id, row.source_line_number, list(row.values)) for row in report.rows
    ]
    return report_row, content_rows


def _values(overrides: dict[str, str]) -> tuple[str, ...]:
    return tuple(overrides.get(column, "") for column in SETTLEMENT_V2_COLUMNS)


__all__ = [
    "MARKETPLACE_ID",
    "MARKETPLACE_NAME",
    "ORDER_ROW_ID",
    "REFUND_ROW_ID",
    "SETTLEMENT_REPORT_ID",
    "stored_report_database_rows",
    "stored_settlement_report",
]
