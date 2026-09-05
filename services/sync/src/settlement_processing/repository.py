"""Load immutable Settlement text and atomically append one processed run."""

from collections.abc import Sequence
from typing import Protocol, cast

from ..amazon.identifiers import validate_marketplace_id
from ..amazon.scopes import validate_amazon_scope
from ..database.connection import DatabaseConnection
from ..database.fee_reference_checks import check_settlement_fee_references
from ..database.seller_namespaces import validate_seller_namespace
from ..database.values import (
    non_negative_int_value,
    normalize_uuid,
    numeric_parameters,
    required_text,
)
from .models import (
    SettlementProcessingPlan,
    StoredSettlementReport,
    StoredSettlementRow,
)
from .queries import (
    INSERT_SETTLEMENT_PROCESSED_ENTRY_SQL,
    INSERT_SETTLEMENT_PROCESSED_REPORT_SQL,
    INSERT_SETTLEMENT_PROCESSED_RESULT_SQL,
    INSERT_SETTLEMENT_PROCESSING_LOG_SQL,
    LOAD_SETTLEMENT_REPORT_ROWS_SQL,
    LOAD_SETTLEMENT_REPORT_SQL,
)


class _Cursor(Protocol):
    def execute(self, sql: str, params: dict[str, object] | None = None) -> object: ...

    def executemany(self, sql: str, params: Sequence[dict[str, object]]) -> object: ...

    def fetchone(self) -> Sequence[object] | None: ...

    def fetchall(self) -> Sequence[Sequence[object]]: ...


def load_settlement_report(
    database: DatabaseConnection,
    settlement_report_id: str,
) -> StoredSettlementReport:
    """Load one immutable raw report using short read-only connection scopes."""
    report_id = normalize_uuid(settlement_report_id, "settlement_report_id")
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(LOAD_SETTLEMENT_REPORT_SQL, {"settlement_report_id": report_id})
        report_row = cursor.fetchone()
        cursor.execute(LOAD_SETTLEMENT_REPORT_ROWS_SQL, {"settlement_report_id": report_id})
        content_rows = cursor.fetchall()
    return _stored_report(report_row, content_rows)


def persist_settlement_processing(
    database: DatabaseConnection,
    plan: SettlementProcessingPlan,
) -> None:
    """Append the log and every processed child in one transaction."""
    _validate_plan(plan)
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as raw_cursor,
    ):
        cursor = cast(_Cursor, raw_cursor)
        _insert_plan(cursor, plan)
    check_settlement_fee_references(database, processing_log_id=plan.processing_log_id)


def _insert_plan(cursor: _Cursor, plan: SettlementProcessingPlan) -> None:
    settlement = plan.settlement
    report_id = settlement.report.id
    processing_log_id = plan.processing_log_id
    cursor.execute(
        INSERT_SETTLEMENT_PROCESSING_LOG_SQL,
        {
            "id": processing_log_id,
            "settlement_report_id": report_id,
            "processor_version": plan.processor_version,
        },
    )
    header = settlement.header
    cursor.execute(
        INSERT_SETTLEMENT_PROCESSED_REPORT_SQL,
        {
            "processing_log_id": processing_log_id,
            "settlement_report_id": report_id,
            "settlement_id": header.settlement_id,
            "settlement_start_at": header.settlement_start_at,
            "settlement_end_at": header.settlement_end_at,
            "deposit_at": header.deposit_at,
            "total_amount": header.total_amount.value,
            "currency": header.currency,
            "settlement_start_date": header.settlement_start_date,
            "settlement_end_date": header.settlement_end_date,
            "processed_entry_count": len(settlement.ledger_entries),
            "processed_result_count": sum(len(group.targets) for group in plan.groups),
        },
    )
    cursor.executemany(
        INSERT_SETTLEMENT_PROCESSED_ENTRY_SQL,
        _entry_parameters(plan),
    )
    cursor.executemany(
        INSERT_SETTLEMENT_PROCESSED_RESULT_SQL,
        _result_parameters(plan),
    )


def _entry_parameters(plan: SettlementProcessingPlan) -> list[dict[str, object]]:
    settlement = plan.settlement
    sources_by_id = {line.settlement_report_line_id: line for line in settlement.source_lines}
    groups_by_entry_id = {
        entry_id: group for group in plan.groups for entry_id in group.ledger_entry_ids
    }
    parameters: list[dict[str, object]] = []
    for entry in settlement.ledger_entries:
        group = groups_by_entry_id[entry.id]
        source = sources_by_id[entry.settlement_report_line_id]
        parameters.append(
            numeric_parameters(
                {
                    "id": entry.id,
                    "processing_log_id": plan.processing_log_id,
                    "settlement_report_id": settlement.report.id,
                    "settlement_report_row_id": source.settlement_report_line_id,
                    "source_line_number": source.source_line_number,
                    "posted_date": entry.posted_date,
                    "posted_at": entry.posted_at,
                    "currency": entry.currency,
                    "settlement_amount": entry.settlement_amount,
                    "transaction_type": entry.transaction_type,
                    "amount_type": entry.amount_type,
                    "amount_description": entry.amount_description,
                    "category_code": group.category_code,
                    "pnl_treatment": group.pnl_treatment,
                    "handling_method": group.handling_method,
                    "amazon_order_id": source.amazon_order_id,
                    "merchant_order_id": source.merchant_order_id,
                    "amazon_order_item_id": source.amazon_order_item_id,
                    "merchant_order_item_id": source.merchant_order_item_id,
                    "amazon_adjustment_id": source.amazon_adjustment_id,
                    "merchant_adjustment_item_id": source.merchant_adjustment_item_id,
                    "amazon_shipment_id": source.amazon_shipment_id,
                    "fulfillment_id": source.fulfillment_id,
                    "marketplace_name": source.marketplace_name,
                    "marketplace_id": entry.marketplace_id,
                    "sku": entry.amz_sku,
                    "quantity": entry.quantity,
                    "promotion_id": source.promotion_id,
                }
            )
        )
    return parameters


def _result_parameters(plan: SettlementProcessingPlan) -> list[dict[str, object]]:
    return [
        numeric_parameters(
            {
                "id": target.id,
                "processing_log_id": plan.processing_log_id,
                "settlement_report_id": plan.settlement.report.id,
                "company_sku_fee_rate_id": target.company_sku_fee_rate_id,
                "company_id": target.company_id,
                "marketplace_id": target.marketplace_id or group.marketplace_id,
                "sku": target.amz_sku,
                "category_code": group.category_code,
                "pnl_treatment": group.pnl_treatment,
                "allocation_method": target.join_method,
                "unassigned_reason": target.unassigned_reason,
                "activity_start_date": target.activity_start_date,
                "activity_end_date": target.activity_end_date,
                "currency": group.currency,
                "settlement_amount": target.settlement_amount,
                "elaborated_amount": target.elaborated_amount,
                "selbox_fee_base": target.selbox_fee_base,
                "applied_fee_rate_percent": target.fee_rate_percent,
                "selbox_fee": target.selbox_fee,
                "settlement_quantity": target.settlement_quantity,
                "elaborated_quantity": target.elaborated_quantity,
                "difference_quantity": target.difference_quantity,
                "selbox_fee_base_quantity": target.selbox_fee_base_quantity,
                "selbox_fee_quantity": target.selbox_fee_quantity,
                "company_payable_quantity": target.company_payable_quantity,
            }
        )
        for group in plan.groups
        for target in group.targets
    ]


def _validate_plan(plan: SettlementProcessingPlan) -> None:
    entry_ids = {entry.id for entry in plan.settlement.ledger_entries}
    grouped_entry_ids = [entry_id for group in plan.groups for entry_id in group.ledger_entry_ids]
    if len(grouped_entry_ids) != len(set(grouped_entry_ids)) or set(grouped_entry_ids) != entry_ids:
        raise ValueError("Processed Settlement groups must cover every entry exactly once.")
    target_ids = [target.id for group in plan.groups for target in group.targets]
    if len(target_ids) != len(set(target_ids)):
        raise ValueError("Processed Settlement result IDs must be unique.")


def _stored_report(
    row: Sequence[object] | None,
    content_rows: Sequence[Sequence[object]],
) -> StoredSettlementReport:
    if row is None:
        raise ValueError("Unknown Settlement report ID.")
    if len(row) != 8:
        raise RuntimeError("Settlement report query returned an unexpected shape.")
    expected_count = non_negative_int_value(row[7], "content_row_count")
    rows = tuple(_stored_content_row(value) for value in content_rows)
    if len(rows) != expected_count:
        raise RuntimeError("Stored Settlement content inventory is incomplete.")
    marketplace_ids = _text_tuple(row[3], "marketplace_ids", require_nonblank=True)
    marketplace_names = _text_tuple(row[4], "marketplace_names", require_nonblank=True)
    if len(marketplace_ids) != len(marketplace_names):
        raise RuntimeError("Stored Settlement marketplace arrays do not align.")
    return StoredSettlementReport(
        id=normalize_uuid(row[0], "settlement_report_id"),
        seller_namespace=validate_seller_namespace(required_text(row[1], "seller_namespace")),
        amazon_scope=validate_amazon_scope(required_text(row[2], "amazon_scope")),
        marketplace_ids=tuple(validate_marketplace_id(value) for value in marketplace_ids),
        marketplace_names=marketplace_names,
        columns=_text_tuple(
            row[5],
            "tsv_columns",
            require_nonempty=True,
            require_unique=True,
        ),
        metadata_values=_text_tuple(row[6], "metadata_values"),
        rows=rows,
    )


def _stored_content_row(row: Sequence[object]) -> StoredSettlementRow:
    if len(row) != 3:
        raise RuntimeError("Settlement content query returned an unexpected shape.")
    return StoredSettlementRow(
        id=normalize_uuid(row[0], "settlement_report_row_id"),
        source_line_number=_positive_int(row[1], "source_line_number"),
        values=_text_tuple(row[2], "column_values"),
    )


def _text_tuple(
    value: object,
    field_name: str,
    *,
    require_nonblank: bool = False,
    require_nonempty: bool = False,
    require_unique: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise RuntimeError(f"{field_name} must be a text array.")
    values_list: list[str] = []
    for item in cast(Sequence[object], value):
        if not isinstance(item, str):
            raise RuntimeError(f"{field_name} must be a text array.")
        values_list.append(item)
    values = tuple(values_list)
    if require_nonblank and (not values or any(not item.strip() for item in values)):
        raise RuntimeError(f"{field_name} must contain nonblank text.")
    if require_nonempty and (not values or any(item == "" for item in values)):
        raise RuntimeError(f"{field_name} must contain nonempty text.")
    if require_unique and len(values) != len(set(values)):
        raise RuntimeError(f"{field_name} must contain unique text.")
    return values


def _positive_int(value: object, field_name: str) -> int:
    parsed = non_negative_int_value(value, field_name)
    if parsed < 1:
        raise RuntimeError(f"{field_name} must be positive.")
    return parsed


__all__ = ["load_settlement_report", "persist_settlement_processing"]
