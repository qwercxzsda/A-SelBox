-- Company components share source authority and signed-fee arithmetic.
-- Wildcards expand typed sources and named CTEs.
-- noqa: disable=AM04
-- This payout/reference resolver uses explicit versions, never current pointers.
-- It shares fee applicability and arithmetic rules with the current live reads.
create function private.resolve_company_components(
    p_settlement_version_ids uuid[], p_data_kiosk_version_ids uuid[], p_terms_version_ids uuid[]
) returns table (
    source text, source_row_id uuid, source_version_id uuid, preprocess_version text,
    source_identity_id uuid, seller_namespace text, marketplace_name text,
    activity_date date, sku text, component_type text, currency text, source_amount numeric,
    quantity numeric, fee_base numeric, category public.allocation_category, authoritative boolean,
    seller_sku_id uuid, terms_version_id uuid, company_id uuid, fee_period_id uuid,
    fee_rate_percent numeric, resolution_status text, fee_amount numeric, company_amount numeric
)
language plpgsql stable set search_path = '' as $$
begin
    if p_settlement_version_ids is null or p_data_kiosk_version_ids is null or p_terms_version_ids is null
        or array_position(p_settlement_version_ids,null) is not null
        or array_position(p_data_kiosk_version_ids,null) is not null
        or array_position(p_terms_version_ids,null) is not null then
        raise exception 'Explicit nonnull version arrays required' using errcode = '23514';
    end if;
    if exists (select 1 from private.settlement_preprocess_versions v
        where v.id = any(p_settlement_version_ids) group by v.settlement_id having count(*) > 1)
        or exists (select 1 from private.data_kiosk_preprocess_versions v
            where v.id = any(p_data_kiosk_version_ids) group by v.day_id having count(*) > 1)
        or exists (select 1 from public.sku_terms_versions v
            where v.id = any(p_terms_version_ids) group by v.seller_sku_id having count(*) > 1) then
        raise exception 'One interpretation per source or seller/SKU identity required' using errcode = '23514';
    end if;
    return query
    with components as (
    select
    'SETTLEMENT'::text as source, -- noqa: RF04
    t.id as source_row_id,
    t.version_id as source_version_id,
    v.preprocess_version,
    v.settlement_id as source_identity_id,
    t.seller_namespace,
    t.marketplace_name,
    t.posted_date as activity_date,
    t.sku,
    t.component_type,
    t.currency,
    t.amount as source_amount,
    t.quantity::numeric as quantity,
    case
        when t.category = 'SETTLEMENT' and private.settlement_fee_applicable(
            t.transaction_type, t.amount_type, t.amount_description
        ) then t.amount
    end as fee_base,
    t.category,
    true as authoritative
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id
where t.category in ('SETTLEMENT', 'SELBOX')
    and t.posted_date < (select private.mature_cutoff_date())
    and v.id = any(p_settlement_version_ids)
union all
select
    'DATA_KIOSK' as source, -- noqa: RF04
    t.id,
    t.version_id,
    v.preprocess_version,
    v.day_id,
    t.seller_namespace,
    t.marketplace_name,
    t.activity_date,
    t.sku,
    t.component_type,
    t.currency,
    t.amount,
    t.quantity,
    t.fee_base,
    t.category,
    (t.category = 'DATA_KIOSK' or (t.activity_date >= (select private.mature_cutoff_date())
        and t.category in ('SETTLEMENT', 'SELBOX'))) as authoritative
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
where v.id = any(p_data_kiosk_version_ids)
union all
select 'RECONCILIATION'::text, private.reconciliation_group_id(r.seller_namespace, r.activity_date, r.marketplace_name, r.currency),
    private.reconciliation_group_id(r.seller_namespace, r.activity_date, r.marketplace_name, r.currency), 'reconciliation-v1'::text,
    private.reconciliation_group_id(r.seller_namespace, r.activity_date, r.marketplace_name, r.currency), r.seller_namespace,
    r.marketplace_name, r.activity_date, null::text, 'SETTLEMENT_KIOSK_DIFFERENCE'::text,
    r.currency, r.difference, null::numeric, null::numeric, 'SELBOX'::public.allocation_category, true
from private.resolve_source_reconciliation(p_settlement_version_ids,p_data_kiosk_version_ids) r
where r.data_kiosk_settlement_control <> 0 or r.data_kiosk_category_amount <> 0
), selected_terms as (
    select s.id as seller_sku_id,s.seller_namespace,s.sku,v.id as terms_version_id,v.company_id
    from public.sku_terms_versions v join public.seller_skus s on s.id = v.seller_sku_id
    where v.id = any(p_terms_version_ids)
), resolved as (
    select
        c.*,
        o.seller_sku_id,
        o.terms_version_id,
        o.company_id,
        p.id as fee_period_id,
        p.fee_rate_percent,
        case
            when c.category = 'SELBOX' then 'NOT_APPLICABLE'
            when o.company_id is null then 'MISSING_OWNERSHIP'
            when c.fee_base is null then 'NOT_APPLICABLE'
            when p.id is null then 'MISSING_FEE'
            else 'APPLIED'
        end as resolution_status
    from components as c
    left join selected_terms as o on c.seller_namespace = o.seller_namespace and c.sku = o.sku
    and c.category <> 'SELBOX'
    left join public.sku_fee_periods as p
        on p.terms_version_id = o.terms_version_id and p.marketplace_name = c.marketplace_name
            and p.valid_period @> c.activity_date and c.fee_base is not null and o.company_id is not null
),

calculated as (
    select
        r.*,
        case
            when not r.authoritative then null::numeric
            when r.resolution_status = 'NOT_APPLICABLE' then 0::numeric
            when
                r.resolution_status = 'APPLIED'
                then private.calculate_service_fee(r.fee_base, r.fee_rate_percent)
        end as fee_amount
    from resolved as r
)

select c.source,c.source_row_id::uuid,c.source_version_id::uuid,c.preprocess_version::text,
    c.source_identity_id::uuid,c.seller_namespace::text,c.marketplace_name,c.activity_date,c.sku::text,
    c.component_type::text,c.currency,c.source_amount::numeric,c.quantity::numeric,c.fee_base::numeric,
    c.category,c.authoritative,c.seller_sku_id::uuid,c.terms_version_id::uuid,c.company_id::uuid,
    c.fee_period_id::uuid,c.fee_rate_percent,c.resolution_status,c.fee_amount,
    case when c.category = 'SELBOX' then 0::numeric
        else c.source_amount + c.fee_amount end as company_amount
from calculated as c;
end;
$$;

-- Keep current-source selection and ownership in one RLS-preserving input view.
-- This private view is not a new Data API resource. Callers still need the same
-- underlying column privileges, and every underlying row policy remains active.
-- Wildcards below expand only explicitly defined CTEs and this input view.
create view private.live_company_component_inputs with (security_invoker = true) as
with components as (
    select
        'SETTLEMENT'::text as source, -- noqa: RF04
        t.id as source_row_id,
        t.version_id as source_version_id,
        v.preprocess_version,
        v.settlement_id as source_identity_id,
        t.seller_namespace,
        t.marketplace_name,
        t.posted_date as activity_date,
        t.sku,
        t.component_type,
        t.currency,
        t.amount as source_amount,
        t.quantity::numeric as quantity,
        case
            when t.category = 'SETTLEMENT' and private.settlement_fee_applicable(
                t.transaction_type, t.amount_type, t.amount_description
            ) then t.amount
        end as fee_base,
        t.category,
        true as authoritative
    from private.settlement_transactions as t
    inner join private.settlement_preprocess_versions as v on t.version_id = v.id
    inner join private.settlements as s
        on v.id = s.current_version_id
    where
        t.category in ('SETTLEMENT', 'SELBOX')
        and t.posted_date < (select private.mature_cutoff_date())
    union all
    select
        'DATA_KIOSK'::text as source, -- noqa: RF04
        t.id,
        t.version_id,
        v.preprocess_version,
        v.day_id,
        t.seller_namespace,
        t.marketplace_name,
        t.activity_date,
        t.sku,
        t.component_type,
        t.currency,
        t.amount,
        t.quantity,
        t.fee_base,
        t.category,
        (t.category = 'DATA_KIOSK' or (
            t.activity_date >= (select private.mature_cutoff_date())
            and t.category in ('SETTLEMENT', 'SELBOX')
        )) as authoritative
    from private.data_kiosk_transactions as t
    inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
    inner join private.data_kiosk_days as d
        on v.id = d.current_version_id
    union all
    select
        'RECONCILIATION'::text,
        private.reconciliation_group_id(
            r.seller_namespace, r.activity_date, r.marketplace_name, r.currency
        ) as source_row_id,
        private.reconciliation_group_id(
            r.seller_namespace, r.activity_date, r.marketplace_name, r.currency
        ) as source_version_id,
        'reconciliation-v1'::text,
        private.reconciliation_group_id(
            r.seller_namespace, r.activity_date, r.marketplace_name, r.currency
        ) as source_identity_id,
        r.seller_namespace,
        r.marketplace_name,
        r.activity_date,
        null::text,
        'SETTLEMENT_KIOSK_DIFFERENCE'::text,
        r.currency,
        r.difference,
        null::numeric,
        null::numeric,
        'SELBOX'::public.allocation_category,
        true as authoritative
    from private.live_source_reconciliation as r
    where r.data_kiosk_settlement_control <> 0 or r.data_kiosk_category_amount <> 0
),

selected_terms as materialized (
    select
        seller_sku_id,
        seller_namespace,
        sku,
        terms_version_id,
        company_id
    from private.current_sku_terms
)

select
    c.*,
    o.seller_sku_id,
    o.terms_version_id,
    o.company_id
from components as c
left join selected_terms as o
    on
        c.seller_namespace = o.seller_namespace and c.sku = o.sku
        and c.category <> 'SELBOX';

-- Complete current rows support strict financial reads and diagnostics.
-- Bounded transaction RPCs share the same arithmetic.
create view public.live_company_components with (security_invoker = true) as
with resolved as (
    select
        c.*,
        p.id as fee_period_id,
        p.fee_rate_percent,
        case
            when c.category = 'SELBOX' then 'NOT_APPLICABLE'
            when c.company_id is null then 'MISSING_OWNERSHIP'
            when c.fee_base is null then 'NOT_APPLICABLE'
            when p.id is null then 'MISSING_FEE'
            else 'APPLIED'
        end as resolution_status
    from private.live_company_component_inputs as c
    left join public.sku_fee_periods as p
        on
            c.terms_version_id = p.terms_version_id
            and c.marketplace_name = p.marketplace_name
            and p.valid_period @> c.activity_date
            and c.fee_base is not null and c.company_id is not null
),

calculated as (
    select
        r.*,
        case
            when not r.authoritative then null::numeric
            when r.resolution_status = 'NOT_APPLICABLE' then 0::numeric
            when r.resolution_status = 'APPLIED'
                then private.calculate_service_fee(r.fee_base, r.fee_rate_percent)
        end as fee_amount
    from resolved as r
)

select
    c.source,
    c.source_row_id::uuid,
    c.source_version_id::uuid,
    c.preprocess_version::text,
    c.source_identity_id::uuid,
    c.seller_namespace::text,
    c.marketplace_name,
    c.activity_date,
    c.sku::text,
    c.component_type::text,
    c.currency,
    c.source_amount::numeric,
    c.quantity::numeric,
    c.fee_base::numeric,
    c.category,
    c.authoritative,
    c.seller_sku_id::uuid,
    c.terms_version_id::uuid,
    c.company_id::uuid,
    c.fee_period_id::uuid,
    c.fee_rate_percent,
    c.resolution_status,
    c.fee_amount,
    case
        when c.category = 'SELBOX' then 0::numeric
        else c.source_amount + c.fee_amount
    end as company_amount
from calculated as c;
