from src.database.base import DatabaseConnection
from src.database.preprocess.common import (
    ALL_MARKETPLACES,
    PreprocessResult,
    require_result_row,
)

ORDER_PREPROCESS_START_SQL: str = """
    with preprocess_run as (
        insert into private.preprocess_runs (
            settlement_id,
            preprocess_version,
            preprocess_type,
            preprocess_description
        )
        values (
            %(settlement_id)s::uuid,
            %(preprocess_version)s,
            'order',
            %(preprocess_description)s
        )
        returning id
    ),

    marked_not_current as (
        update private.order_transactions
        set is_current = false
        where
            settlement_id = %(settlement_id)s::uuid
            and is_current
        returning id
    )

    select
        (select id from preprocess_run)::text as preprocess_run_id,
        (select count(*) from marked_not_current)::int as marked_not_current_count
"""

ORDER_PREPROCESS_INSERT_SQL: str = """
    with
    source_rows as (
        select
            st.id,
            st.settlement_id,
            st.amz_report_line_no,
            st.amz_transaction_type,
            st.amz_order_id,
            st.amz_marketplace_name,
            st.amz_amount_type,
            st.amz_amount_description,
            st.amz_amount,
            st.amz_posted_date_time,
            st.amz_order_item_code,
            st.amz_sku,
            st.amz_quantity_purchased,
            s.amz_currency
        from private.settlement_transactions as st
        inner join private.settlements as s
            on s.id = st.settlement_id
        where
            st.settlement_id = %(settlement_id)s::uuid
            and st.amz_order_id is not null
            and st.amz_sku is not null
    ),

    typed_source_rows as (
        select
            sr.id,
            sr.settlement_id,
            sr.amz_report_line_no,
            sr.amz_transaction_type,
            sr.amz_order_id,
            nullif(sr.amz_marketplace_name, '') as amz_marketplace_name,
            sr.amz_amount_type,
            sr.amz_amount_description,
            replace(sr.amz_amount, ',', '.')::numeric(38, 6) as amz_amount,
            case
                when sr.amz_posted_date_time ~ '^\\d{2}\\.\\d{2}\\.\\d{4} '
                    then (
                        substring(sr.amz_posted_date_time from 7 for 4)
                        || '-'
                        || substring(sr.amz_posted_date_time from 4 for 2)
                        || '-'
                        || substring(sr.amz_posted_date_time from 1 for 2)
                        || substring(sr.amz_posted_date_time from 11)
                    )::timestamptz
                else sr.amz_posted_date_time::timestamptz
            end as amz_posted_date_time,
            sr.amz_order_item_code,
            sr.amz_sku,
            nullif(replace(sr.amz_quantity_purchased, ',', '.'), '')::numeric(38, 6)
                as amz_quantity_purchased,
            sr.amz_currency
        from source_rows as sr
    ),

    quantity_rows as (
        select
            tsr.settlement_id,
            tsr.amz_order_id,
            tsr.amz_sku,
            tsr.amz_order_item_code,
            max(tsr.amz_quantity_purchased) as amz_quantity_purchased
        from typed_source_rows as tsr
        where tsr.amz_quantity_purchased is not null
        group by
            tsr.settlement_id,
            tsr.amz_order_id,
            tsr.amz_sku,
            tsr.amz_order_item_code
    ),

    quantity_by_group as (
        select
            qr.settlement_id,
            qr.amz_order_id,
            qr.amz_sku,
            sum(qr.amz_quantity_purchased)::int4 as amz_quantity_purchased
        from quantity_rows as qr
        group by
            qr.settlement_id,
            qr.amz_order_id,
            qr.amz_sku
    ),

    grouped_order_rows as (
        select
            tsr.settlement_id,
            min(tsr.amz_posted_date_time) as amz_posted_date_time,
            tsr.amz_sku,
            tsr.amz_order_id,
            (
                array_agg(tsr.amz_marketplace_name order by tsr.amz_report_line_no)
                filter (where tsr.amz_marketplace_name is not null)
            )[1] as amz_marketplace_name,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type = 'Order'
                    and tsr.amz_amount_type = 'ItemPrice'
            ) as amz_order_item_price,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type = 'Order'
                    and tsr.amz_amount_type = 'ItemFees'
            ) as amz_order_item_fees,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type = 'Order'
                    and tsr.amz_amount_type = 'ItemWithheldTax'
            ) as amz_order_item_withheld_tax,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type = 'Order'
                    and tsr.amz_amount_type = 'Promotion'
            ) as amz_order_promotion,
            sum(tsr.amz_amount) filter (
                where tsr.amz_transaction_type = 'Refund'
            ) as amz_refund,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type != 'Refund'
                    and not (
                        tsr.amz_transaction_type = 'Order'
                        and tsr.amz_amount_type in (
                            'ItemPrice',
                            'ItemFees',
                            'ItemWithheldTax',
                            'Promotion'
                        )
                    )
            ) as amz_others,
            sum(tsr.amz_amount) filter (
                where
                    tsr.amz_transaction_type in ('Order', 'Refund')
                    and tsr.amz_amount_type in ('ItemPrice', 'Promotion')
            ) as selbox_fee_base,
            qbg.amz_quantity_purchased,
            jsonb_build_object(
                'source_transaction_count',
                count(*),
                'source_report_line_nos',
                to_jsonb(array_agg(tsr.amz_report_line_no order by tsr.amz_report_line_no))
            ) as amz_details,
            tsr.amz_currency
        from typed_source_rows as tsr
        left join quantity_by_group as qbg
            on
                qbg.settlement_id = tsr.settlement_id
                and qbg.amz_order_id = tsr.amz_order_id
                and qbg.amz_sku = tsr.amz_sku
        group by
            tsr.settlement_id,
            tsr.amz_order_id,
            tsr.amz_sku,
            qbg.amz_quantity_purchased,
            tsr.amz_currency
    ),

    order_rows_with_fees as (
        select
            gor.*,
            cf.id as company_fee_id,
            cf.company_id,
            case
                when cf.id is null or gor.selbox_fee_base is null
                    then null
                else (-gor.selbox_fee_base * cf.fee_rate)::numeric(38, 6)
            end as selbox_fees
        from grouped_order_rows as gor
        left join lateral (
            select
                company_fees.id,
                company_fees.company_id,
                company_fees.fee_rate
            from public.company_fees
            where
                company_fees.amz_sku = gor.amz_sku
                and company_fees.valid_period @> gor.amz_posted_date_time
                and company_fees.amz_marketplace_name in (
                    coalesce(gor.amz_marketplace_name, %(all_marketplaces)s),
                    %(all_marketplaces)s
                )
            order by
                case
                    when company_fees.amz_marketplace_name
                        = coalesce(gor.amz_marketplace_name, %(all_marketplaces)s)
                        then 0
                    else 1
                end
            limit 1
        ) as cf
            on true
    ),

    inserted_order_transactions as (
        insert into private.order_transactions (
            settlement_id,
            preprocess_run_id,
            amz_posted_date_time,
            amz_sku,
            amz_order_id,
            amz_marketplace_name,
            amz_order_item_price,
            amz_order_item_fees,
            amz_order_item_withheld_tax,
            amz_order_promotion,
            amz_refund,
            amz_others,
            selbox_fees,
            amz_quantity_purchased,
            amz_details,
            amz_currency,
            company_id,
            company_fee_id
        )
        select
            orwf.settlement_id,
            %(preprocess_run_id)s::uuid,
            orwf.amz_posted_date_time,
            orwf.amz_sku,
            orwf.amz_order_id,
            orwf.amz_marketplace_name,
            orwf.amz_order_item_price,
            orwf.amz_order_item_fees,
            orwf.amz_order_item_withheld_tax,
            orwf.amz_order_promotion,
            orwf.amz_refund,
            orwf.amz_others,
            orwf.selbox_fees,
            orwf.amz_quantity_purchased,
            orwf.amz_details,
            orwf.amz_currency,
            orwf.company_id,
            orwf.company_fee_id
        from order_rows_with_fees as orwf
        returning
            id,
            settlement_id,
            amz_order_id,
            amz_sku
    ),

    inserted_mappings as (
        insert into private.settlement_transactions_order_transactions (
            settlement_transaction_id,
            order_transaction_id
        )
        select
            tsr.id,
            iot.id
        from typed_source_rows as tsr
        inner join inserted_order_transactions as iot
            on
                iot.settlement_id = tsr.settlement_id
                and iot.amz_order_id = tsr.amz_order_id
                and iot.amz_sku = tsr.amz_sku
        returning id
    )

    select
        (select count(*) from inserted_order_transactions)::int as inserted_count,
        (select count(*) from inserted_mappings)::int as mapping_count
"""


def preprocess_order_transactions(
    database: DatabaseConnection,
    settlement_id: str,
    preprocess_version: str,
    preprocess_description: str,
) -> PreprocessResult:
    """Preprocess order+SKU settlement rows for one settlement."""
    params: dict[str, str] = {
        "settlement_id": settlement_id,
        "preprocess_version": preprocess_version,
        "preprocess_description": preprocess_description,
        "all_marketplaces": ALL_MARKETPLACES,
    }

    with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
        cursor.execute(ORDER_PREPROCESS_START_SQL, params)
        start_row = require_result_row(cursor.fetchone(), "order", "start")
        preprocess_run_id: str = str(start_row[0])
        marked_not_current_count: int = int(start_row[1])

        cursor.execute(
            ORDER_PREPROCESS_INSERT_SQL,
            {
                **params,
                "preprocess_run_id": preprocess_run_id,
            },
        )
        insert_row = require_result_row(cursor.fetchone(), "order", "insert")

    return PreprocessResult(
        settlement_id=settlement_id,
        preprocess_run_id=preprocess_run_id,
        preprocess_type="order",
        inserted_count=int(insert_row[0]),
        mapping_count=int(insert_row[1]),
        marked_not_current_count=marked_not_current_count,
    )
