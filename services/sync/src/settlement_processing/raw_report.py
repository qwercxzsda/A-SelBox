"""Convert immutable raw Settlement text into one versioned processing input."""

from collections import defaultdict
from collections.abc import Callable, Mapping
from datetime import UTC, timedelta

from ..amazon.settlement_values import (
    parse_currency_code,
    parse_settlement_amount,
    parse_settlement_date,
    parse_settlement_quantity,
    parse_settlement_timestamp,
)
from ..numeric import ZERO
from .ledger_entry_builder import build_ledger_entry
from .models import (
    PreparedSettlement,
    SettlementHeader,
    SettlementSourceLine,
    StoredSettlementReport,
    StoredSettlementRow,
)

_METADATA_COLUMNS = (
    "settlement-id",
    "settlement-start-date",
    "settlement-end-date",
    "deposit-date",
    "total-amount",
    "currency",
)


def prepare_settlement_report(
    report: StoredSettlementReport,
    *,
    id_factory: Callable[[], str],
) -> PreparedSettlement:
    """Apply all value conversion at Workflow B, never at ingestion."""
    metadata = _row_mapping(report.columns, report.metadata_values)
    header = _parse_header(report, metadata)
    source_lines = tuple(_parse_source_line(report.columns, row, header) for row in report.rows)
    if not source_lines:
        raise ValueError("Settlement processing requires at least one content row.")
    if sum((line.settlement_amount for line in source_lines), ZERO) != header.total_amount:
        raise ValueError("Settlement content rows do not reconcile to the metadata total.")

    marketplace_ids_by_name = _marketplace_ids_by_name(report)
    default_marketplace_id = report.marketplace_ids[0] if len(report.marketplace_ids) == 1 else None
    ledger_entries = tuple(
        build_ledger_entry(
            line,
            report.id,
            marketplace_ids_by_name,
            settlement_currency=header.currency,
            ledger_entry_id=id_factory(),
            default_marketplace_id=default_marketplace_id,
        )
        for line in source_lines
    )
    posted_dates = tuple(line.posted_date for line in source_lines)
    return PreparedSettlement(
        report=report,
        header=header,
        source_lines=source_lines,
        ledger_entries=ledger_entries,
        transaction_start_date=min(posted_dates),
        transaction_end_date_exclusive=max(posted_dates) + timedelta(days=1),
    )


def _parse_header(
    report: StoredSettlementReport,
    metadata: Mapping[str, str],
) -> SettlementHeader:
    settlement_start_at = parse_settlement_timestamp(_required(metadata, "settlement-start-date"))
    settlement_end_at = parse_settlement_timestamp(_required(metadata, "settlement-end-date"))
    if settlement_start_at > settlement_end_at:
        raise ValueError("Settlement start timestamp is after its end timestamp.")
    total_amount = parse_settlement_amount(_required(metadata, "total-amount"))
    return SettlementHeader(
        settlement_id=_required(metadata, "settlement-id"),
        seller_namespace=report.seller_namespace,
        amazon_scope=report.amazon_scope,
        settlement_start_at=settlement_start_at.astimezone(UTC),
        settlement_end_at=settlement_end_at.astimezone(UTC),
        deposit_at=parse_settlement_timestamp(_required(metadata, "deposit-date")).astimezone(UTC),
        total_amount=total_amount,
        currency=parse_currency_code(_required(metadata, "currency")),
        settlement_start_date=settlement_start_at.date(),
        settlement_end_date=settlement_end_at.date(),
        marketplace_ids=report.marketplace_ids,
    )


def _parse_source_line(
    columns: tuple[str, ...],
    stored_row: StoredSettlementRow,
    header: SettlementHeader,
) -> SettlementSourceLine:
    row = _row_mapping(columns, stored_row.values)
    if _required(row, "settlement-id") != header.settlement_id:
        raise ValueError(
            f"Settlement content row {stored_row.source_line_number} has a different settlement-id."
        )
    if any(row.get(column, "").strip() for column in _METADATA_COLUMNS[1:]):
        raise ValueError(
            f"Settlement content row {stored_row.source_line_number} contains metadata values."
        )
    posted_at = parse_settlement_timestamp(_required(row, "posted-date-time"))
    posted_date = parse_settlement_date(_required(row, "posted-date"))
    if posted_date != posted_at.date():
        raise ValueError(
            f"Settlement content row {stored_row.source_line_number} has inconsistent posted dates."
        )
    if not header.settlement_start_at <= posted_at <= header.settlement_end_at:
        raise ValueError(
            f"Settlement content row {stored_row.source_line_number} has a posted timestamp "
            "outside the Settlement header period."
        )
    # Daily acquisition and matching retain source calendar dates, even when
    # timestamp offsets differ. Validate that coverage separately from instants.
    if not header.settlement_start_date <= posted_date <= header.settlement_end_date:
        raise ValueError(
            f"Settlement content row {stored_row.source_line_number} has a posted date "
            "outside the Settlement header date window."
        )
    settlement_amount = parse_settlement_amount(_required(row, "amount"))
    return SettlementSourceLine(
        settlement_report_line_id=stored_row.id,
        source_line_number=stored_row.source_line_number,
        transaction_type=_required(row, "transaction-type"),
        amazon_order_id=_nullable(row, "order-id"),
        merchant_order_id=_nullable(row, "merchant-order-id"),
        amazon_adjustment_id=_nullable(row, "adjustment-id"),
        amazon_shipment_id=_nullable(row, "shipment-id"),
        marketplace_name=_nullable(row, "marketplace-name"),
        amount_type=_required(row, "amount-type"),
        amount_description=_required(row, "amount-description"),
        settlement_amount=settlement_amount,
        fulfillment_id=_nullable(row, "fulfillment-id"),
        posted_date=posted_date,
        posted_at=posted_at.astimezone(UTC),
        amazon_order_item_id=_nullable(row, "order-item-code"),
        merchant_order_item_id=_nullable(row, "merchant-order-item-id"),
        merchant_adjustment_item_id=_nullable(row, "merchant-adjustment-item-id"),
        amz_sku=_nullable(row, "sku"),
        quantity=parse_settlement_quantity(_nullable(row, "quantity-purchased")),
        promotion_id=_nullable(row, "promotion-id"),
    )


def _marketplace_ids_by_name(report: StoredSettlementReport) -> dict[str, tuple[str, ...]]:
    if len(report.marketplace_ids) != len(report.marketplace_names):
        raise ValueError("Stored Settlement marketplace IDs and names do not align.")
    grouped: defaultdict[str, list[str]] = defaultdict(list)
    for name, marketplace_id in zip(report.marketplace_names, report.marketplace_ids, strict=True):
        grouped[name].append(marketplace_id)
    return {name: tuple(marketplace_ids) for name, marketplace_ids in grouped.items()}


def _row_mapping(columns: tuple[str, ...], values: tuple[str, ...]) -> dict[str, str]:
    if len(columns) != len(values):
        raise ValueError("Stored Settlement row width differs from its header.")
    return dict(zip(columns, values, strict=True))


def _required(row: Mapping[str, str], column: str) -> str:
    value = row.get(column)
    if value is None or not value.strip():
        raise ValueError(f"Settlement processing requires column {column}.")
    return value.strip()


def _nullable(row: Mapping[str, str], column: str) -> str | None:
    value = row.get(column, "").strip()
    return value or None


__all__ = ["prepare_settlement_report"]
