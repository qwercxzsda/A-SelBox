-- Raw data: the current version of each advertising invoice and warehouse report,
-- as Amazon gave it, for administrators. Invoker security keeps the source RLS; the
-- explicit gate gives members an empty result. Domains are cast to their base types,
-- so the REST API reads plain dates, timestamps, numbers and text. processed_at is
-- when SelBox last observed the current version.

create view public.current_ad_invoices with (security_invoker = true) as
select
    i.version_id::uuid as id,
    u.seller_namespace::text as seller_namespace,
    u.amazon_scope::text as amazon_scope,
    i.version_id::uuid as version_id,
    b.created_at as processed_at,
    i.invoice_id::text as invoice_id,
    i.profile_id::text as profile_id,
    i.marketplace_name::text as marketplace_name,
    i.invoice_status,
    i.invoice_date,
    i.from_date,
    i.to_date,
    i.currency,
    i.amount_due::numeric as amount_due,
    i.tax_amount_due::numeric as tax_amount_due,
    i.tax_name,
    i.tax_country,
    i.tax_rate_stated::numeric as tax_rate_stated,
    i.tax_rate_percent,
    i.line_count
from private.ad_invoices as i
inner join private.source_units as u on i.version_id = u.current_version_id
inner join private.source_preprocess_batches as b on u.current_batch_id = b.id
where (select private.is_administrator());

-- Lines carry their invoice's currency. The drawer reads one invoice by version_id.
create view public.current_ad_invoice_lines with (security_invoker = true) as
select
    l.id::uuid as id,
    l.version_id::uuid as version_id,
    l.line_number,
    l.line_kind,
    l.adjustment_kind,
    l.campaign_id,
    l.campaign_aid,
    l.campaign_name,
    l.ad_program,
    l.description,
    i.currency,
    l.cost_amount::numeric as cost_amount,
    l.base_amount::numeric as base_amount,
    l.tax_amount::numeric as tax_amount
from private.ad_invoice_lines as l
inner join private.ad_invoices as i on l.version_id = i.version_id
inner join private.source_units as u on i.version_id = u.current_version_id
where (select private.is_administrator());

create view public.current_storage_rows with (security_invoker = true) as
select
    r.id::uuid as id,
    u.seller_namespace::text as seller_namespace,
    u.amazon_scope::text as amazon_scope,
    r.version_id::uuid as version_id,
    b.created_at as processed_at,
    r.row_number,
    r.month_of_charge::date as month_of_charge,
    r.marketplace_name::text as marketplace_name,
    r.country_code::text as country_code,
    r.fulfillment_center,
    r.fnsku::text as fnsku,
    r.asin::text as asin,
    r.average_quantity_on_hand::numeric as average_quantity_on_hand,
    r.product_size_tier::text as product_size_tier,
    r.estimated_total_item_volume::numeric as estimated_total_item_volume,
    r.volume_units,
    r.storage_rate::numeric as storage_rate,
    r.base_rate::numeric as base_rate,
    r.utilization_surcharge_rate::numeric as utilization_surcharge_rate,
    r.storage_utilization_ratio,
    r.est_vol_for_sus::numeric as est_vol_for_sus,
    r.est_base_msf::numeric as est_base_msf,
    r.est_sus::numeric as est_sus,
    r.currency,
    r.fee_amount::numeric as fee_amount,
    r.base_amount::numeric as base_amount,
    r.tax_amount::numeric as tax_amount,
    r.ledger_first_month::date as ledger_first_month,
    r.ledger_last_month::date as ledger_last_month
from private.storage_rows as r
inner join private.source_units as u on r.version_id = u.current_version_id
inner join private.source_preprocess_batches as b on u.current_batch_id = b.id
where (select private.is_administrator());

create view public.current_aged_storage_rows with (security_invoker = true) as
select
    r.id::uuid as id,
    u.seller_namespace::text as seller_namespace,
    u.amazon_scope::text as amazon_scope,
    r.version_id::uuid as version_id,
    b.created_at as processed_at,
    r.row_number,
    r.snapshot_at,
    r.snapshot_month::date as snapshot_month,
    r.marketplace_name::text as marketplace_name,
    r.country_code::text as country_code,
    r.fnsku::text as fnsku,
    r.asin::text as asin,
    r.sku_printed,
    r.condition, -- noqa: RF04
    r.age_tier,
    r.quantity_charged::numeric as quantity_charged,
    r.currency,
    r.fee_amount::numeric as fee_amount,
    r.base_amount::numeric as base_amount,
    r.tax_amount::numeric as tax_amount,
    r.ledger_first_month::date as ledger_first_month,
    r.ledger_last_month::date as ledger_last_month
from private.aged_storage_rows as r
inner join private.source_units as u on r.version_id = u.current_version_id
inner join private.source_preprocess_batches as b on u.current_batch_id = b.id
where (select private.is_administrator());

-- Amazon gives no marketplace for a removal order. request_date, the UTC day of
-- requested_at, stays beside it as in the frontend contract.
create view public.current_removal_order_rows with (security_invoker = true) as
select -- noqa: ST06
    r.id::uuid as id,
    u.seller_namespace::text as seller_namespace,
    u.amazon_scope::text as amazon_scope,
    r.version_id::uuid as version_id,
    b.created_at as processed_at,
    r.row_number,
    r.removal_order_id::text as removal_order_id,
    r.requested_at,
    (r.requested_at at time zone 'UTC')::date as request_date,
    r.last_updated_at,
    r.order_type,
    r.order_status::text as order_status,
    r.fnsku::text as fnsku,
    r.sku_printed,
    r.disposition,
    r.requested_quantity::numeric as requested_quantity,
    r.cancelled_quantity::numeric as cancelled_quantity,
    r.disposed_quantity::numeric as disposed_quantity,
    r.shipped_quantity::numeric as shipped_quantity,
    r.in_process_quantity::numeric as in_process_quantity,
    r.currency,
    r.fee_amount::numeric as fee_amount,
    r.base_amount::numeric as base_amount,
    r.tax_amount::numeric as tax_amount,
    r.ledger_first_month::date as ledger_first_month,
    r.ledger_last_month::date as ledger_last_month
from private.removal_order_rows as r
inner join private.source_units as u on r.version_id = u.current_version_id
inner join private.source_preprocess_batches as b on u.current_batch_id = b.id
where (select private.is_administrator());
