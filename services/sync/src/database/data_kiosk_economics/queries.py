"""SQL for appending provision processes and pruning older results."""

INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL = """
    insert into private.data_kiosk_provision_processing_logs (
        id,
        seller_namespace,
        amazon_scope,
        marketplace_ids,
        processor_version,
        provision_row_count
    )
    values (
        %(id)s::uuid,
        %(seller_namespace)s,
        %(amazon_scope)s,
        %(marketplace_ids)s::text[],
        %(processor_version)s,
        %(provision_row_count)s
    )
"""

PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL = """
    select private.prune_data_kiosk_provision_results(
        %(seller_namespace)s,
        %(amazon_scope)s,
        %(keep_latest)s
    )
"""

INSERT_DATA_KIOSK_PROVISION_SQL = """
    insert into private.data_kiosk_provisions (
        processing_log_id,
        seller_namespace,
        amazon_scope,
        marketplace_id,
        activity_date,
        sku,
        currency,
        company_sku_fee_rate_id,
        company_id,
        child_asin,
        fnsku,
        parent_asin,
        units_sold,
        units_returned,
        net_units_sold,
        average_sales_price,
        product_sales,
        product_refunds,
        net_product_sales,
        amazon_fee_total,
        amazon_fee_total_quantity,
        advertising_total,
        advertising_total_quantity,
        cost_of_goods_sold_per_unit,
        shipping_to_amazon_cost_per_unit,
        mfn_fulfillment_cost_per_unit,
        mfn_storage_cost_per_unit,
        miscellaneous_cost_per_unit,
        net_proceeds_per_unit,
        net_proceeds_total,
        net_proceeds_total_quantity,
        fee_breakdown,
        ad_breakdown,
        selbox_fee_base,
        applied_fee_rate_percent,
        selbox_fee,
        refreshed_at
    )
    values (
        %(processing_log_id)s::uuid,
        %(seller_namespace)s,
        %(amazon_scope)s,
        %(marketplace_id)s,
        %(activity_date)s,
        %(sku)s,
        %(currency)s,
        %(company_sku_fee_rate_id)s::uuid,
        %(company_id)s::uuid,
        %(child_asin)s,
        %(fnsku)s,
        %(parent_asin)s,
        %(units_sold)s,
        %(units_returned)s,
        %(net_units_sold)s,
        %(average_sales_price)s,
        %(product_sales)s,
        %(product_refunds)s,
        %(net_product_sales)s,
        %(amazon_fee_total)s,
        %(amazon_fee_total_quantity)s,
        %(advertising_total)s,
        %(advertising_total_quantity)s,
        %(cost_of_goods_sold_per_unit)s,
        %(shipping_to_amazon_cost_per_unit)s,
        %(mfn_fulfillment_cost_per_unit)s,
        %(mfn_storage_cost_per_unit)s,
        %(miscellaneous_cost_per_unit)s,
        %(net_proceeds_per_unit)s,
        %(net_proceeds_total)s,
        %(net_proceeds_total_quantity)s,
        %(fee_breakdown)s::jsonb,
        %(ad_breakdown)s::jsonb,
        %(selbox_fee_base)s,
        %(applied_fee_rate_percent)s,
        %(selbox_fee)s,
        %(refreshed_at)s
    )
"""

__all__ = [
    "INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL",
    "INSERT_DATA_KIOSK_PROVISION_SQL",
    "PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL",
]
