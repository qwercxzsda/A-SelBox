from src.database.base import DatabaseConnection
from src.database.preprocess.common import (
    ALL_MARKETPLACES,
    UNKNOWN_SKU,
    PreprocessResult,
    require_result_row,
)

NO_SKU_PREPROCESS_START_SQL: str = """
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
            'no_sku',
            %(preprocess_description)s
        )
        returning id
    ),

    marked_not_current as (
        update private.no_sku_transactions as nst
        set is_current = false
        from private.settlement_transactions as st
        where
            nst.settlement_transaction_id = st.id
            and st.settlement_id = %(settlement_id)s::uuid
            and nst.is_current
        returning nst.id
    )

    select
        (select id from preprocess_run)::text as preprocess_run_id,
        (select count(*) from marked_not_current)::int as marked_not_current_count
"""

NO_SKU_PREPROCESS_INSERT_SQL: str = """
    with
    source_rows as (
        select
            st.id as settlement_transaction_id,
            st.amz_transaction_type,
            st.amz_order_id,
            st.amz_marketplace_name,
            st.amz_amount_type,
            st.amz_amount_description,
            st.amz_amount,
            st.amz_posted_date_time,
            st.amz_sku as raw_amz_sku,
            coalesce(st.amz_sku, %(unknown_sku)s) as amz_sku,
            s.amz_currency
        from private.settlement_transactions as st
        inner join private.settlements as s
            on s.id = st.settlement_id
        where
            st.settlement_id = %(settlement_id)s::uuid
            and (
                st.amz_order_id is null
                or st.amz_sku is null
            )
    ),

    typed_source_rows as (
        select
            sr.settlement_transaction_id,
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
            sr.raw_amz_sku,
            sr.amz_sku,
            sr.amz_currency
        from source_rows as sr
    ),

    no_sku_rows_with_company as (
        select
            tsr.*,
            cf.company_id
        from typed_source_rows as tsr
        left join lateral (
            select company_fees.company_id
            from public.company_fees
            where
                tsr.raw_amz_sku is not null
                and company_fees.amz_sku = tsr.raw_amz_sku
                and company_fees.valid_period @> tsr.amz_posted_date_time
                and company_fees.amz_marketplace_name in (
                    coalesce(tsr.amz_marketplace_name, %(all_marketplaces)s),
                    %(all_marketplaces)s
                )
            order by
                case
                    when company_fees.amz_marketplace_name
                        = coalesce(tsr.amz_marketplace_name, %(all_marketplaces)s)
                        then 0
                    else 1
                end
            limit 1
        ) as cf
            on true
    ),

    inserted_no_sku_transactions as (
        insert into private.no_sku_transactions (
            settlement_transaction_id,
            amz_posted_date_time,
            amz_sku,
            amz_order_id,
            amz_marketplace_name,
            amz_transaction_type,
            amz_amount_type,
            amz_amount_description,
            amz_amount,
            amz_currency,
            company_id,
            preprocess_run_id
        )
        select
            nst.settlement_transaction_id,
            nst.amz_posted_date_time,
            nst.amz_sku,
            nst.amz_order_id,
            nst.amz_marketplace_name,
            nst.amz_transaction_type,
            nst.amz_amount_type,
            nst.amz_amount_description,
            nst.amz_amount,
            nst.amz_currency,
            nst.company_id,
            %(preprocess_run_id)s::uuid
        from no_sku_rows_with_company as nst
        returning id
    )

    select
        (select count(*) from inserted_no_sku_transactions)::int as inserted_count
"""


def preprocess_no_sku_transactions(
    database: DatabaseConnection,
    settlement_id: str,
    preprocess_version: str,
    preprocess_description: str,
) -> PreprocessResult:
    """Preprocess settlement rows without a complete order+SKU key."""
    params: dict[str, str] = {
        "settlement_id": settlement_id,
        "preprocess_version": preprocess_version,
        "preprocess_description": preprocess_description,
        "unknown_sku": UNKNOWN_SKU,
        "all_marketplaces": ALL_MARKETPLACES,
    }

    with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
        cursor.execute(NO_SKU_PREPROCESS_START_SQL, params)
        start_row = require_result_row(cursor.fetchone(), "no_sku", "start")
        preprocess_run_id: str = str(start_row[0])
        marked_not_current_count: int = int(start_row[1])

        cursor.execute(
            NO_SKU_PREPROCESS_INSERT_SQL,
            {
                **params,
                "preprocess_run_id": preprocess_run_id,
            },
        )
        insert_row = require_result_row(cursor.fetchone(), "no_sku", "insert")

    return PreprocessResult(
        settlement_id=settlement_id,
        preprocess_run_id=preprocess_run_id,
        preprocess_type="no_sku",
        inserted_count=int(insert_row[0]),
        marked_not_current_count=marked_not_current_count,
    )
