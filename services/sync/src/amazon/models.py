from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ParsedSettlement:
    amz_region: str
    amz_settlement_id: str
    amz_document_id: str
    amz_settlement_start_date: str
    amz_settlement_end_date: str
    amz_deposit_date: str
    amz_total_amount: str
    amz_currency: str


@dataclass(frozen=True)
class ParsedSettlementTransaction:
    amz_report_line_no: int
    amz_transaction_type: str
    amz_order_id: str | None
    amz_merchant_order_id: str | None
    amz_adjustment_id: str | None
    amz_shipment_id: str | None
    amz_marketplace_name: str | None
    amz_amount_type: str
    amz_amount_description: str
    amz_amount: str
    amz_fulfillment_id: str | None
    amz_posted_date: str
    amz_posted_date_time: str
    amz_order_item_code: str | None
    amz_merchant_order_item_id: str | None
    amz_merchant_adjustment_item_id: str | None
    amz_sku: str | None
    amz_quantity_purchased: str | None
    amz_promotion_id: str | None


@dataclass(frozen=True)
class ParsedSettlementReport:
    settlement: ParsedSettlement
    transactions: list[ParsedSettlementTransaction]


@dataclass(frozen=True)
class DownloadedSettlementReport:
    report_id: str
    report_document_id: str
    path: Path
