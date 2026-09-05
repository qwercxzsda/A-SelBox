-- Fee publications replace the whole prior version for the same company identity.

alter table public.company_sku_fee_rates
drop constraint ex_company_sku_fee_rates_no_overlap;

create index idx_company_sku_fee_rates_latest
on public.company_sku_fee_rates (
    seller_namespace,
    marketplace_id,
    sku,
    company_id,
    created_at desc,
    id desc
);

create view private.latest_company_sku_fee_rates
with (security_invoker = true)
as
select distinct on (
    fee_rate.seller_namespace,
    fee_rate.marketplace_id,
    fee_rate.sku,
    fee_rate.company_id
)
    fee_rate.id,
    fee_rate.seller_namespace,
    fee_rate.marketplace_id,
    fee_rate.sku,
    fee_rate.company_id,
    fee_rate.fee_rate_percent,
    fee_rate.valid_period,
    fee_rate.created_at
from public.company_sku_fee_rates as fee_rate
order by
    fee_rate.seller_namespace asc,
    fee_rate.marketplace_id asc,
    fee_rate.sku asc,
    fee_rate.company_id asc,
    fee_rate.created_at desc,
    fee_rate.id desc;

create function private.enforce_current_company_sku_fee_period()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
    -- Repeatable Read snapshots do not refresh after waiting for the lock.
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
        raise exception using
            errcode = '25000',
            message = 'Company/SKU fee inserts require READ COMMITTED isolation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        pg_catalog.jsonb_build_array(
            'company_sku_fee_rates',
            new.seller_namespace,
            new.marketplace_id,
            new.sku
        )::text,
        0
    ));

    -- Keep this read separate from lock acquisition: VOLATILE functions take
    -- a fresh Read Committed snapshot for each query, including after a wait.
    if exists (
        select 1
        from private.latest_company_sku_fee_rates as current_fee
        where current_fee.seller_namespace = new.seller_namespace
          and current_fee.marketplace_id = new.marketplace_id
          and current_fee.sku = new.sku
          and current_fee.company_id = new.company_id
          and (current_fee.created_at, current_fee.id) >= (new.created_at, new.id)
    ) then
        return new;
    end if;

    if exists (
        select 1
        from private.latest_company_sku_fee_rates as current_fee
        where current_fee.seller_namespace = new.seller_namespace
          and current_fee.marketplace_id = new.marketplace_id
          and current_fee.sku = new.sku
          and current_fee.company_id <> new.company_id
          and current_fee.valid_period && new.valid_period
    ) then
        raise exception using
            errcode = '23P01',
            message = 'Current company fee periods cannot overlap for the same seller/marketplace/SKU.';
    end if;

    return new;
end;
$$;

create trigger enforce_current_company_sku_fee_period
before insert
on public.company_sku_fee_rates
for each row
execute function private.enforce_current_company_sku_fee_period();

revoke all on private.latest_company_sku_fee_rates
from public, anon, authenticated, service_role;
revoke all on function private.enforce_current_company_sku_fee_period()
from public, anon, authenticated, service_role;
