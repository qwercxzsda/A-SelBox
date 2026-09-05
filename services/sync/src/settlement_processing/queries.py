"""SQL for loading and persisting Settlement processing data."""

LOAD_SETTLEMENT_REPORT_SQL = """
    select
        report.id::text,
        report.seller_namespace,
        report.amazon_scope,
        report.marketplace_ids,
        report.marketplace_names,
        report.tsv_columns,
        report.metadata_values,
        report.content_row_count
    from private.settlement_reports as report
    where report.id = %(settlement_report_id)s::uuid
"""

LOAD_SETTLEMENT_REPORT_ROWS_SQL = """
    select
        report_row.id::text,
        report_row.source_line_number,
        report_row.column_values
    from private.settlement_report_rows as report_row
    where report_row.settlement_report_id = %(settlement_report_id)s::uuid
    order by report_row.source_line_number
"""

INSERT_SETTLEMENT_PROCESSING_LOG_SQL = """
    insert into private.settlement_processing_logs (
        id,
        settlement_report_id,
        processor_version
    )
    values (
        %(id)s::uuid,
        %(settlement_report_id)s::uuid,
        %(processor_version)s
    )
"""

INSERT_SETTLEMENT_PROCESSED_REPORT_SQL = """
    insert into private.settlement_processed_reports (
        processing_log_id,
        settlement_report_id,
        settlement_id,
        settlement_start_at,
        settlement_end_at,
        deposit_at,
        total_amount,
        currency,
        settlement_start_date,
        settlement_end_date,
        processed_entry_count,
        processed_result_count
    )
    values (
        %(processing_log_id)s::uuid,
        %(settlement_report_id)s::uuid,
        %(settlement_id)s,
        %(settlement_start_at)s,
        %(settlement_end_at)s,
        %(deposit_at)s,
        %(total_amount)s,
        %(currency)s,
        %(settlement_start_date)s,
        %(settlement_end_date)s,
        %(processed_entry_count)s,
        %(processed_result_count)s
    )
"""

INSERT_SETTLEMENT_PROCESSED_ENTRY_SQL = """
    insert into private.settlement_processed_entries (
        id,
        processing_log_id,
        settlement_report_id,
        settlement_report_row_id,
        source_line_number,
        posted_date,
        posted_at,
        currency,
        settlement_amount,
        transaction_type,
        amount_type,
        amount_description,
        category_code,
        pnl_treatment,
        handling_method,
        amazon_order_id,
        merchant_order_id,
        amazon_order_item_id,
        merchant_order_item_id,
        amazon_adjustment_id,
        merchant_adjustment_item_id,
        amazon_shipment_id,
        fulfillment_id,
        marketplace_name,
        marketplace_id,
        sku,
        quantity,
        promotion_id
    )
    values (
        %(id)s::uuid,
        %(processing_log_id)s::uuid,
        %(settlement_report_id)s::uuid,
        %(settlement_report_row_id)s::uuid,
        %(source_line_number)s,
        %(posted_date)s,
        %(posted_at)s,
        %(currency)s,
        %(settlement_amount)s,
        %(transaction_type)s,
        %(amount_type)s,
        %(amount_description)s,
        %(category_code)s,
        %(pnl_treatment)s,
        %(handling_method)s,
        %(amazon_order_id)s,
        %(merchant_order_id)s,
        %(amazon_order_item_id)s,
        %(merchant_order_item_id)s,
        %(amazon_adjustment_id)s,
        %(merchant_adjustment_item_id)s,
        %(amazon_shipment_id)s,
        %(fulfillment_id)s,
        %(marketplace_name)s,
        %(marketplace_id)s,
        %(sku)s,
        %(quantity)s,
        %(promotion_id)s
    )
"""

INSERT_SETTLEMENT_PROCESSED_RESULT_SQL = """
    insert into private.settlement_processed_results (
        id,
        processing_log_id,
        settlement_report_id,
        company_sku_fee_rate_id,
        company_id,
        marketplace_id,
        sku,
        category_code,
        pnl_treatment,
        allocation_method,
        unassigned_reason,
        activity_start_date,
        activity_end_date,
        currency,
        settlement_amount,
        elaborated_amount,
        selbox_fee_base,
        applied_fee_rate_percent,
        selbox_fee,
        settlement_quantity,
        elaborated_quantity,
        difference_quantity,
        selbox_fee_base_quantity,
        selbox_fee_quantity,
        company_payable_quantity
    )
    values (
        %(id)s::uuid,
        %(processing_log_id)s::uuid,
        %(settlement_report_id)s::uuid,
        %(company_sku_fee_rate_id)s::uuid,
        %(company_id)s::uuid,
        %(marketplace_id)s,
        %(sku)s,
        %(category_code)s,
        %(pnl_treatment)s,
        %(allocation_method)s,
        %(unassigned_reason)s,
        %(activity_start_date)s,
        %(activity_end_date)s,
        %(currency)s,
        %(settlement_amount)s,
        %(elaborated_amount)s,
        %(selbox_fee_base)s,
        %(applied_fee_rate_percent)s,
        %(selbox_fee)s,
        %(settlement_quantity)s,
        %(elaborated_quantity)s,
        %(difference_quantity)s,
        %(selbox_fee_base_quantity)s,
        %(selbox_fee_quantity)s,
        %(company_payable_quantity)s
    )
"""

__all__ = [
    "INSERT_SETTLEMENT_PROCESSED_ENTRY_SQL",
    "INSERT_SETTLEMENT_PROCESSED_REPORT_SQL",
    "INSERT_SETTLEMENT_PROCESSED_RESULT_SQL",
    "INSERT_SETTLEMENT_PROCESSING_LOG_SQL",
    "LOAD_SETTLEMENT_REPORT_ROWS_SQL",
    "LOAD_SETTLEMENT_REPORT_SQL",
]
