-- Wildcards select known typed source relations and the preceding named CTE.
-- noqa: disable=AM04
-- Shared relational ownership and current fee selection. No rolling date windows.
-- Scalar business rules stay inlinable: no SET clauses or data access.
-- Existing callers resolve these fully qualified helpers under their own scope.
create function private.settlement_fee_applicable(
    p_transaction_type text, p_amount_type text, p_amount_description text
) returns boolean
language sql immutable parallel safe security invoker as $$
    select p_transaction_type in ('Order', 'Refund')
        and p_amount_type = 'ItemPrice' and p_amount_description = 'Principal';
$$;

create function private.calculate_service_fee(p_fee_base numeric, p_fee_rate_percent numeric)
returns numeric
language sql immutable parallel safe security invoker as $$
    select -(p_fee_base * p_fee_rate_percent * 0.01);
$$;

-- Include explicitly unassigned current terms; their NULL company is part of
-- existing missing-ownership diagnostics. The invoker retains both tables' RLS.
create view private.current_sku_terms with (security_invoker = true) as
select
    s.id as seller_sku_id,
    s.seller_namespace,
    s.sku,
    v.id as terms_version_id,
    v.company_id
from public.seller_skus as s
inner join public.sku_terms_versions as v
    on s.id = v.seller_sku_id and s.current_terms_version_id = v.id;

revoke all on private.current_sku_terms from public, anon, authenticated, service_role;
revoke all on function private.settlement_fee_applicable(text, text, text),
private.calculate_service_fee(numeric, numeric) from public, anon, authenticated, service_role;

create view public.company_skus with (security_invoker = true) as
select
    seller_sku_id as id,
    seller_namespace,
    sku,
    company_id,
    terms_version_id
from private.current_sku_terms
where company_id is not null;

create view public.current_sku_fee_periods with (security_invoker = true) as
select
    s.id as seller_sku_id,
    s.company_id,
    s.terms_version_id,
    p.marketplace_name,
    p.id as fee_period_id,
    p.valid_period,
    p.fee_rate_percent
from public.company_skus as s
inner join public.sku_fee_periods as p on s.terms_version_id = p.terms_version_id;

create view public.settlement_sku_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.settlement_id
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id
inner join private.settlements as s on v.settlement_id = s.id and v.id = s.current_version_id
where t.category = 'SETTLEMENT';
create view public.settlement_account_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.settlement_id
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id
inner join private.settlements as s on v.settlement_id = s.id and v.id = s.current_version_id
where t.category = 'SELBOX';
create view public.settlement_others_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.settlement_id
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id
inner join private.settlements as s on v.settlement_id = s.id and v.id = s.current_version_id
where t.category = 'DATA_KIOSK';
create view public.data_kiosk_sku_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.day_id
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
inner join private.data_kiosk_days as d on v.day_id = d.id and v.id = d.current_version_id
where t.category = 'SETTLEMENT';
create view public.data_kiosk_account_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.day_id
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
inner join private.data_kiosk_days as d on v.day_id = d.id and v.id = d.current_version_id
where t.category = 'SELBOX';
create view public.data_kiosk_others_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.day_id
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
inner join private.data_kiosk_days as d on v.day_id = d.id and v.id = d.current_version_id
where t.category = 'DATA_KIOSK';

-- This payout/reference resolver uses explicit versions, never current pointers.
-- It shares fee applicability and arithmetic rules with the current live reads.
create function private.resolve_company_components(
    p_settlement_version_ids uuid[], p_data_kiosk_version_ids uuid[], p_terms_version_ids uuid[]
) returns table (
    source text, source_row_id uuid, source_version_id uuid, preprocess_version text,
    source_identity_id uuid, seller_namespace text, marketplace_name public.amazon_marketplace_name,
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
        when private.settlement_fee_applicable(
            t.transaction_type, t.amount_type, t.amount_description
        ) then t.amount
    end as fee_base,
    t.category,
    true as authoritative
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id
where t.category = 'SETTLEMENT' and v.id = any(p_settlement_version_ids)
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
    t.category = 'DATA_KIOSK' as authoritative
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
where v.id = any(p_data_kiosk_version_ids)
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
            when o.company_id is null then 'MISSING_OWNERSHIP'
            when c.fee_base is null then 'NOT_APPLICABLE'
            when p.id is null then 'MISSING_FEE'
            else 'APPLIED'
        end as resolution_status
    from components as c
    left join selected_terms as o on c.seller_namespace = o.seller_namespace and c.sku = o.sku
    left join public.sku_fee_periods as p
        on p.terms_version_id = o.terms_version_id and p.marketplace_name = c.marketplace_name
            and p.valid_period @> c.activity_date and c.fee_base is not null and o.company_id is not null
),

calculated as (
    select
        r.*,
        case
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
    c.source_amount + c.fee_amount as company_amount
from calculated as c;
end;
$$;

-- Keep current-source selection and ownership in one RLS-preserving input view.
-- This private view is not a new Data API resource. Callers still need the same
-- underlying column privileges, and every underlying row policy remains active.
-- Wildcards below expand only explicitly defined CTEs and this input view.
-- noqa: disable=AM04
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
            when private.settlement_fee_applicable(
                t.transaction_type, t.amount_type, t.amount_description
            ) then t.amount
        end as fee_base,
        t.category,
        true as authoritative
    from private.settlement_transactions as t
    inner join private.settlement_preprocess_versions as v on t.version_id = v.id
    inner join private.settlements as s
        on v.id = s.current_version_id
    where t.category = 'SETTLEMENT'
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
        t.category = 'DATA_KIOSK' as authoritative
    from private.data_kiosk_transactions as t
    inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id
    inner join private.data_kiosk_days as d
        on v.id = d.current_version_id
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
    on c.seller_namespace = o.seller_namespace and c.sku = o.sku;

-- Complete current rows support company-amount ordering, text search, and
-- strict financial reads. Bounded transaction RPCs share the same arithmetic.
create view public.live_company_components with (security_invoker = true) as
with resolved as (
    select
        c.*,
        p.id as fee_period_id,
        p.fee_rate_percent,
        case
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
    c.source_amount + c.fee_amount as company_amount
from calculated as c;

-- A complete financial request declares all required canonical settlements and
-- marketplace-local days. Missing or incompatible inputs raise, never disappear
-- through filtering, RLS, NULL SUM behavior, or implicit source substitution.
create function private.assert_company_source_scope(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[],
    p_marketplaces public.amazon_marketplace_name[],
    p_dataset_key text default 'economics'
) returns void
language plpgsql stable set search_path = '' as $$
begin
    if nullif(btrim(p_seller_namespace),'') is null or nullif(btrim(p_preprocess_version),'') is null
        or p_start is null or p_end is null or p_end < p_start
        or p_settlement_ids is null or p_marketplaces is null
        or p_dataset_key is distinct from 'economics'
        or array_position(p_settlement_ids,null) is not null or array_position(p_marketplaces,null) is not null then
        raise exception 'Explicit valid financial input scope required' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_settlement_ids) requested(id)
        left join private.settlements s on s.id = requested.id and s.seller_namespace = p_seller_namespace
        left join private.settlement_preprocess_versions v on v.id = s.current_version_id
        where v.id is null or v.preprocess_version <> p_preprocess_version
    ) then raise exception 'Missing or incompatible required Settlement version' using errcode = '23514'; end if;
    if exists (
        select 1 from unnest(p_marketplaces) m(name)
        cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') date_scope(day)
        left join private.data_kiosk_days d on d.seller_namespace = p_seller_namespace
            and d.marketplace_name = m.name and d.activity_date = date_scope.day::date and d.dataset_key = p_dataset_key
        left join private.data_kiosk_preprocess_versions v on v.id = d.current_version_id
        where v.id is null or v.preprocess_version <> p_preprocess_version
           or exists (select 1 from private.data_kiosk_pruned_versions pruned where pruned.version_id = v.id)
    ) then raise exception 'Missing or incompatible required Data Kiosk day coverage' using errcode = '23514'; end if;
end;
$$;

create function private.company_financial_totals(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[], p_marketplaces public.amazon_marketplace_name[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid,
    currency text,
    source_amount numeric,
    fee_amount numeric,
    company_amount numeric
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_settlement_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces)
                and c.category = 'DATA_KIOSK'))
          and c.resolution_status not in ('APPLIED','NOT_APPLICABLE')
    ) then raise exception 'Unresolved ownership or fee coverage' using errcode = '23514'; end if;
    return query select c.company_id::uuid,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount)
        from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
        group by c.company_id,c.currency;
end;
$$;

-- Partial live summaries tolerate missing fee coverage only. They never invent
-- zero for an absent sum and never hide missing ownership or source coverage.
create function private.company_financial_progress(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[], p_marketplaces public.amazon_marketplace_name[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid, currency text, source_amount numeric, known_fee_amount numeric,
    known_company_amount numeric, missing_fee_count bigint, missing_fee_components jsonb
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_settlement_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
          and c.resolution_status = 'MISSING_OWNERSHIP'
    ) then raise exception 'Unresolved ownership' using errcode = '23514'; end if;
    return query
    select c.company_id,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount),
        count(*) filter (where c.resolution_status = 'MISSING_FEE'),
        coalesce(jsonb_agg(
            (to_jsonb(c) - array['source_amount','quantity','fee_base','fee_rate_percent','fee_amount','company_amount'])
            || jsonb_build_object('source_amount',c.source_amount::text,'quantity',c.quantity::text,
                'fee_base',c.fee_base::text,'fee_rate_percent',c.fee_rate_percent::text,
                'fee_amount',c.fee_amount::text,'company_amount',c.company_amount::text)
            order by c.source,c.source_row_id
        ) filter (where c.resolution_status = 'MISSING_FEE'),'[]'::jsonb)
    from public.live_company_components c
    where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
      and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
        or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
    group by c.company_id,c.currency;
end;
$$;

-- Compare normalized complete contents, never totals alone. A missing compatible
-- result or pruned payload makes comparison unavailable, including empty days.
create function private.compare_data_kiosk_observations(p_day_id uuid, p_preprocess_version text)
returns jsonb language sql stable set search_path = '' as $$
with observations as (
    select distinct a.id,a.root_query_created_at from private.data_kiosk_preprocess_versions v
    join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
    join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.day_id = p_day_id
    order by a.root_query_created_at desc,a.id desc limit 3
), versions as (
    select o.id as acquisition_id,v.* from observations o
    left join lateral (
        select v.* from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        where v.day_id = p_day_id and b.acquisition_id = o.id and v.preprocess_version = p_preprocess_version
        order by v.id desc limit 1
    ) v on true
)
select jsonb_build_object('available',count(*) = 3 and count(id) = 3 and not bool_or(exists (
        select 1 from private.data_kiosk_pruned_versions p where p.version_id = versions.id
    )), 'equal',case when count(*) = 3 and count(id) = 3 and not bool_or(exists (
        select 1 from private.data_kiosk_pruned_versions p where p.version_id = versions.id
    )) then count(distinct content_sha256) = 1 else null end,
    'observations',coalesce(jsonb_agg(jsonb_build_object('acquisition_id',acquisition_id,'version_id',id,
        'content_sha256',content_sha256,'row_count',row_count)),'[]'::jsonb)) from versions;
$$;
