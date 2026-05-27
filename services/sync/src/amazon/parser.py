import csv
from functools import partial
from pathlib import Path

from src.amazon.marketplaces import validate_endpoint
from src.amazon.models import (
    ParsedSettlement,
    ParsedSettlementReport,
    ParsedSettlementTransaction,
)


def _normalize_text(value: str | None) -> str:
    """Return a trimmed text value for a raw Amazon report field."""
    return (value or "").strip()


def _get_required_field(
    row: dict[str, str],
    column: str,
    report_path: Path,
) -> str:
    """Return a required report field or fail with file context."""
    value: str = _normalize_text(row.get(column))
    if not value:
        raise ValueError(f"Missing required column {column} in {report_path}.")
    return value


def _get_nullable_field(row: dict[str, str], column: str) -> str | None:
    """Return a nullable transaction field, converting blank values to None."""
    value: str = _normalize_text(row.get(column))
    return value or None


def parse_settlement_report(
    report_path: Path,
    amazon_endpoint: str,
    report_document_id: str,
) -> ParsedSettlementReport:
    """Parse one Amazon settlement TSV into settlement and transaction rows."""
    endpoint: str = validate_endpoint(amazon_endpoint)

    with report_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter="\t")
        rows: list[dict[str, str]] = list(reader)

    if not rows:
        raise ValueError(f"Settlement report is empty: {report_path}.")

    # First data row is settlement metadata; every later row is a transaction.
    first_row: dict[str, str] = rows[0]
    settlement_field = partial(_get_required_field, first_row, report_path=report_path)
    settlement = ParsedSettlement(
        amz_region=endpoint,
        amz_settlement_id=settlement_field("settlement-id"),
        amz_document_id=report_document_id,
        amz_settlement_start_date=settlement_field("settlement-start-date"),
        amz_settlement_end_date=settlement_field("settlement-end-date"),
        amz_deposit_date=settlement_field("deposit-date"),
        amz_total_amount=settlement_field("total-amount"),
        amz_currency=settlement_field("currency"),
    )

    transactions: list[ParsedSettlementTransaction] = []
    for row_index, row in enumerate(rows[1:], start=3):
        required_field = partial(_get_required_field, row, report_path=report_path)
        nullable_field = partial(_get_nullable_field, row)
        transactions.append(
            ParsedSettlementTransaction(
                # Line 1 is the header and line 2 is settlement metadata.
                amz_report_line_no=row_index,
                amz_transaction_type=required_field("transaction-type"),
                amz_order_id=nullable_field("order-id"),
                amz_merchant_order_id=nullable_field("merchant-order-id"),
                amz_adjustment_id=nullable_field("adjustment-id"),
                amz_shipment_id=nullable_field("shipment-id"),
                amz_marketplace_name=nullable_field("marketplace-name"),
                amz_amount_type=required_field("amount-type"),
                amz_amount_description=required_field("amount-description"),
                amz_amount=required_field("amount"),
                amz_fulfillment_id=nullable_field("fulfillment-id"),
                amz_posted_date=required_field("posted-date"),
                amz_posted_date_time=required_field("posted-date-time"),
                amz_order_item_code=nullable_field("order-item-code"),
                amz_merchant_order_item_id=nullable_field("merchant-order-item-id"),
                amz_merchant_adjustment_item_id=nullable_field("merchant-adjustment-item-id"),
                amz_sku=nullable_field("sku"),
                amz_quantity_purchased=nullable_field("quantity-purchased"),
                amz_promotion_id=nullable_field("promotion-id"),
            )
        )

    return ParsedSettlementReport(settlement=settlement, transactions=transactions)
