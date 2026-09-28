-- Shared daily account controls for live reads and frozen reports.
-- noqa: disable=AM04
-- Stable group identity survives source reprocessing; JSON preserves NULL and
-- separators, while the numeric day offset avoids session date formatting.
create function private.reconciliation_group_id(
    p_seller_namespace text, p_activity_date date, p_marketplace_name text, p_currency text
) returns uuid
language sql immutable parallel safe security invoker set search_path = '' as $$
    select md5(jsonb_build_array(p_seller_namespace,p_activity_date-date '2000-01-01',
        p_marketplace_name,p_currency)::text)::uuid;
$$;

-- Raw categories remain preprocessing decisions. Reconciliation compares only
-- Data Kiosk category controls and costs; every group retains its original marketplace/date.
create view private.source_reconciliation_inputs with (security_invoker = true) as
select
    'SETTLEMENT'::text as source, -- noqa: RF04
    t.version_id as source_version_id,
    t.seller_namespace,
    t.posted_date as activity_date,
    t.marketplace_name,
    t.currency,
    t.category,
    t.amount
from private.settlement_transactions as t
where
    t.posted_date < (select private.mature_cutoff_date())
    and (select private.financial_account_visible())
union all
select
    'DATA_KIOSK'::text,
    t.version_id,
    t.seller_namespace,
    t.activity_date,
    t.marketplace_name,
    t.currency,
    t.category,
    t.amount
from private.data_kiosk_transactions as t
where
    t.category = 'DATA_KIOSK'
    and t.activity_date < (select private.mature_cutoff_date())
    and (select private.financial_account_visible());

-- One arithmetic definition serves current and explicitly pinned source groups.
-- No SET clause: this pure SQL expression remains inlinable beneath date filters.
create function private.reconcile_source_amounts(
    p_settlement_category_amount numeric, p_selbox_category_amount numeric,
    p_data_kiosk_settlement_control numeric, p_data_kiosk_category_amount numeric
) returns table (difference numeric, settlement_total numeric, accounted_total numeric)
language sql immutable parallel safe security invoker as $$
    select p_data_kiosk_settlement_control - p_data_kiosk_category_amount,
        p_settlement_category_amount + p_selbox_category_amount + p_data_kiosk_settlement_control,
        p_settlement_category_amount + p_selbox_category_amount + p_data_kiosk_category_amount
            + (p_data_kiosk_settlement_control - p_data_kiosk_category_amount);
$$;

create function private.resolve_source_reconciliation(
    p_settlement_version_ids uuid[], p_data_kiosk_version_ids uuid[]
) returns table (
    seller_namespace text, activity_date date, marketplace_name text, currency text,
    settlement_category_amount numeric,
    selbox_category_amount numeric,
    data_kiosk_settlement_control numeric,
    data_kiosk_category_amount numeric,
    difference numeric,
    settlement_total numeric,
    accounted_total numeric
)
language sql stable security invoker set search_path = '' as $$
    with grouped as (
select i.seller_namespace::text, i.activity_date, i.marketplace_name, i.currency,
    coalesce(sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'SETTLEMENT'),0)
        as settlement_category_amount,
    coalesce(sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'SELBOX'),0)
        as selbox_category_amount,
    coalesce(sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'DATA_KIOSK'),0)
        as data_kiosk_settlement_control,
    coalesce(sum(i.amount) filter (where i.source = 'DATA_KIOSK'),0) as data_kiosk_category_amount
from private.source_reconciliation_inputs i
where (i.source = 'SETTLEMENT' and i.source_version_id = any(p_settlement_version_ids))
    or (i.source = 'DATA_KIOSK' and i.source_version_id = any(p_data_kiosk_version_ids))
group by i.seller_namespace, i.activity_date, i.marketplace_name, i.currency
)
select g.*, amounts.difference, amounts.settlement_total, amounts.accounted_total
from grouped g
cross join lateral private.reconcile_source_amounts(
    g.settlement_category_amount,g.selbox_category_amount,
    g.data_kiosk_settlement_control,g.data_kiosk_category_amount
) amounts;
$$;

create view private.live_source_reconciliation with (security_invoker = true) as
with grouped as (
    select
        i.seller_namespace::text,
        i.activity_date,
        i.marketplace_name,
        i.currency,
        coalesce(
            sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'SETTLEMENT'), 0
        )
            as settlement_category_amount,
        coalesce(sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'SELBOX'), 0)
            as selbox_category_amount,
        coalesce(
            sum(i.amount) filter (where i.source = 'SETTLEMENT' and i.category = 'DATA_KIOSK'), 0
        )
            as data_kiosk_settlement_control,
        coalesce(sum(i.amount) filter (where i.source = 'DATA_KIOSK'), 0)
            as data_kiosk_category_amount
    from private.source_reconciliation_inputs as i
    where (i.source = 'SETTLEMENT' and exists (
        select 1 from private.settlements as s
        where s.current_version_id = i.source_version_id
    ))
    or (i.source = 'DATA_KIOSK' and exists (
        select 1 from private.data_kiosk_days as d
        where d.current_version_id = i.source_version_id
    ))
    group by i.seller_namespace, i.activity_date, i.marketplace_name, i.currency
)

select
    g.*,
    amounts.difference,
    amounts.settlement_total,
    amounts.accounted_total
from grouped as g
cross join lateral private.reconcile_source_amounts(
    g.settlement_category_amount, g.selbox_category_amount,
    g.data_kiosk_settlement_control, g.data_kiosk_category_amount
) as amounts;
