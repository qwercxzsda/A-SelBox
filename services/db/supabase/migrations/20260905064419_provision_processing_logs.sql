-- Keep successful provision batches independently; current views select one per partition.

create function private.is_canonical_marketplace_ids(candidate text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select private.is_unique_nonblank_text_array(candidate)
        and candidate = array(
            select marketplace.id
            from pg_catalog.unnest(candidate) as marketplace (id)
            order by marketplace.id
        );
$$;

create table private.data_kiosk_provision_processing_logs (
    id uuid primary key default gen_random_uuid(),
    seller_namespace text not null,
    amazon_scope text not null,
    marketplace_ids text[] not null,
    processor_version text not null,
    processed_at timestamptz default current_timestamp not null,
    provision_row_count bigint not null,

    constraint ck_data_kiosk_provision_processing_logs_identity
    check (
        seller_namespace = pg_catalog.btrim(seller_namespace)
        and seller_namespace <> ''
        and processor_version = pg_catalog.btrim(processor_version)
        and processor_version <> ''
    ),

    constraint ck_data_kiosk_provision_processing_logs_scope
    check (amazon_scope in ('NA', 'EU', 'JAPAN', 'SINGAPORE', 'AUSTRALIA')),

    constraint ck_data_kiosk_provision_processing_logs_marketplaces
    check (private.is_canonical_marketplace_ids(marketplace_ids)),

    constraint ck_data_kiosk_provision_processing_logs_row_count
    check (provision_row_count >= 0)
);

create index idx_data_kiosk_provision_processing_logs_latest
on private.data_kiosk_provision_processing_logs (
    seller_namespace,
    amazon_scope,
    processed_at desc,
    id desc
);

alter table private.data_kiosk_provisions
add column id uuid default gen_random_uuid() not null,
add column processing_log_id uuid;

-- The old table contains only surviving rows, not historical run identities.
-- Import each existing partition as one explicitly labeled batch without changing its facts.
with imported_logs as (
    insert into private.data_kiosk_provision_processing_logs (
        seller_namespace,
        amazon_scope,
        marketplace_ids,
        processor_version,
        processed_at,
        provision_row_count
    )
    select
        provision.seller_namespace,
        provision.amazon_scope,
        array[provision.marketplace_id] as marketplace_ids,
        'legacy-import:20260905064419' as processor_version,
        max(provision.refreshed_at) as processed_at,
        count(*) as provision_row_count
    from private.data_kiosk_provisions as provision
    group by provision.seller_namespace, provision.amazon_scope, provision.marketplace_id
    returning id, seller_namespace, amazon_scope, marketplace_ids
)

update private.data_kiosk_provisions as provision
set processing_log_id = imported_log.id
from imported_logs as imported_log
where
    provision.seller_namespace = imported_log.seller_namespace
    and provision.amazon_scope = imported_log.amazon_scope
    and provision.marketplace_id = imported_log.marketplace_ids[1];

alter table private.data_kiosk_provisions
alter column processing_log_id set not null,
drop constraint data_kiosk_provisions_pkey,
add primary key (id),
add constraint fk_data_kiosk_provisions_processing_log
foreign key (processing_log_id)
references private.data_kiosk_provision_processing_logs (id),
add constraint uq_data_kiosk_provisions_processing_identity
unique (
    processing_log_id,
    seller_namespace,
    amazon_scope,
    marketplace_id,
    activity_date,
    sku,
    currency
);

create function private.enforce_provision_processing_log()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    processing_log record;
begin
    select log.xmin, log.seller_namespace, log.amazon_scope, log.marketplace_ids
    into processing_log
    from private.data_kiosk_provision_processing_logs as log
    where log.id = new.processing_log_id;

    if not found
       or not private.is_current_transaction_xid(processing_log.xmin)
    then
        raise exception 'Provisions must be inserted with their processing log.';
    end if;

    if new.seller_namespace <> processing_log.seller_namespace
       or new.amazon_scope <> processing_log.amazon_scope
       or not (new.marketplace_id = any(processing_log.marketplace_ids))
    then
        raise exception 'Provision identity must match its processing log coverage.';
    end if;

    return new;
end;
$$;

create trigger enforce_provision_processing_log
before insert
on private.data_kiosk_provisions
for each row
execute function private.enforce_provision_processing_log();

create trigger reject_data_kiosk_provision_processing_log_mutation
before update or delete
on private.data_kiosk_provision_processing_logs
for each row
execute function private.reject_append_only_mutation();

create trigger reject_data_kiosk_provision_processing_log_truncate
before truncate
on private.data_kiosk_provision_processing_logs
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_data_kiosk_provision_update
before update
on private.data_kiosk_provisions
for each row
execute function private.reject_append_only_mutation();

create view private.latest_data_kiosk_provision_processing_logs
with (security_invoker = true)
as
select distinct on (
    processing_log.seller_namespace,
    processing_log.amazon_scope,
    marketplace.id
)
    processing_log.id,
    processing_log.seller_namespace,
    processing_log.amazon_scope,
    marketplace.id as marketplace_id,
    processing_log.marketplace_ids,
    processing_log.processor_version,
    processing_log.processed_at,
    processing_log.provision_row_count
from private.data_kiosk_provision_processing_logs as processing_log
cross join lateral pg_catalog.unnest(processing_log.marketplace_ids) as marketplace (id)
order by
    processing_log.seller_namespace asc,
    processing_log.amazon_scope asc,
    marketplace.id asc,
    processing_log.processed_at desc,
    processing_log.id desc;

create view private.latest_data_kiosk_provisions
with (security_invoker = true)
as
select
    provision.id,
    provision.processing_log_id,
    provision.seller_namespace,
    provision.amazon_scope,
    provision.marketplace_id,
    provision.activity_date,
    provision.sku,
    provision.currency,
    provision.company_id,
    provision.company_sku_fee_rate_id,
    provision.child_asin,
    provision.fnsku,
    provision.parent_asin,
    provision.units_sold,
    provision.units_returned,
    provision.net_units_sold,
    provision.average_sales_price,
    provision.product_sales,
    provision.product_refunds,
    provision.net_product_sales,
    provision.amazon_fee_total,
    provision.advertising_total,
    provision.cost_of_goods_sold_per_unit,
    provision.shipping_to_amazon_cost_per_unit,
    provision.mfn_fulfillment_cost_per_unit,
    provision.mfn_storage_cost_per_unit,
    provision.miscellaneous_cost_per_unit,
    provision.net_proceeds_per_unit,
    provision.net_proceeds_total,
    provision.fee_breakdown,
    provision.ad_breakdown,
    provision.selbox_fee_base,
    provision.applied_fee_rate_percent,
    provision.selbox_fee,
    provision.product_sales_quantity,
    provision.product_refunds_quantity,
    provision.net_product_sales_quantity,
    provision.selbox_fee_base_quantity,
    provision.selbox_fee_quantity,
    provision.amazon_fee_total_quantity,
    provision.advertising_total_quantity,
    provision.net_proceeds_total_quantity,
    provision.refreshed_at
from private.data_kiosk_provisions as provision
inner join private.latest_data_kiosk_provision_processing_logs as latest_log
    on
        provision.processing_log_id = latest_log.id
        and provision.seller_namespace = latest_log.seller_namespace
        and provision.amazon_scope = latest_log.amazon_scope
        and provision.marketplace_id = latest_log.marketplace_id;

create function private.prune_data_kiosk_provision_results(
    p_seller_namespace text,
    p_amazon_scope text,
    p_keep_latest integer
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
    deleted_row_count bigint;
begin
    if p_seller_namespace is null
       or p_seller_namespace = ''
       or p_seller_namespace <> pg_catalog.btrim(p_seller_namespace)
       or p_amazon_scope is null
       or p_amazon_scope not in ('NA', 'EU', 'JAPAN', 'SINGAPORE', 'AUSTRALIA')
       or p_keep_latest is null
       or p_keep_latest < 1
    then
        raise exception using
            errcode = '22023',
            message = 'Pruning requires a valid seller namespace, Amazon scope, and keep count >= 1.';
    end if;

    with ranked_logs as (
        select
            processing_log.id,
            marketplace.id as marketplace_id,
            row_number() over (
                partition by marketplace.id
                order by processing_log.processed_at desc, processing_log.id desc
            ) as position
        from private.data_kiosk_provision_processing_logs as processing_log
        cross join lateral pg_catalog.unnest(processing_log.marketplace_ids) as marketplace (id)
        where processing_log.seller_namespace = p_seller_namespace
          and processing_log.amazon_scope = p_amazon_scope
    )
    delete from private.data_kiosk_provisions as provision
    using ranked_logs as ranked_log
    where provision.processing_log_id = ranked_log.id
      and provision.marketplace_id = ranked_log.marketplace_id
      and provision.seller_namespace = p_seller_namespace
      and provision.amazon_scope = p_amazon_scope
      and ranked_log.position > p_keep_latest;

    get diagnostics deleted_row_count = row_count;
    return deleted_row_count;
end;
$$;

comment on table private.data_kiosk_provision_processing_logs is
'Immutable successful provision batches, including empty marketplace results; '
'legacy-import versions identify preexisting partitions without historical run identities.';

comment on column private.data_kiosk_provision_processing_logs.provision_row_count is
'Original inserted row count supplied by the processor; retention may remove those rows.';

comment on table private.data_kiosk_provisions is
'Processed facts belonging to immutable successful batches; updates are rejected and '
'explicit retention may delete historical rows.';

comment on function private.prune_data_kiosk_provision_results(text, text, integer) is
'Delete results outside the newest k successful logs per seller/scope/marketplace; '
'keep all logs, including empty batches. No cleanup runs automatically.';

alter table private.data_kiosk_provision_processing_logs enable row level security;

revoke all on table
private.data_kiosk_provision_processing_logs,
private.latest_data_kiosk_provision_processing_logs,
private.latest_data_kiosk_provisions
from public, anon, authenticated, service_role;

revoke all on function
private.is_canonical_marketplace_ids(text[]),
private.enforce_provision_processing_log(),
private.prune_data_kiosk_provision_results(text, text, integer)
from public, anon, authenticated, service_role;
