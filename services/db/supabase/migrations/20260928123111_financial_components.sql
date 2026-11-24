-- Preserve the row types consumed by RPCs and the positional UNION branches.
-- noqa: disable=ST06
-- Version selections are shared by live screens and immutable payout replay.
-- Null selects current pointers. An empty array deliberately selects no versions.
create function private.selected_units(p_versions uuid[], p_finances boolean)
returns table (
    unit_id uuid, version_id uuid, source text, seller_namespace text,
    amazon_scope text, unit_key text, preprocess_version text
)
language sql stable as $$
    select u.id, u.current_version_id, u.source::text, u.seller_namespace,
        u.amazon_scope, u.unit_key, b.preprocess_version
    from private.source_units u
    join private.source_preprocess_batches b on b.id = u.current_batch_id
    where p_versions is null and (u.source = 'FINANCES') = p_finances
    union all
    (
        select distinct on (m.version_id) u.id, m.version_id, u.source::text,
            u.seller_namespace, u.amazon_scope, u.unit_key, b.preprocess_version
        from private.source_batch_units m
        join private.source_units u on u.id = m.unit_id
        join private.source_preprocess_batches b on b.id = m.batch_id
        where p_versions is not null and m.version_id = any(p_versions)
            and (u.source = 'FINANCES') = p_finances
        order by m.version_id, b.created_at, b.id
    );
$$;

-- Reference costs use the Finances sign. Marketplace is part of the storage key only.
create view private.reference_money with (security_invoker = true) as
select
    i.version_id,
    l.id,
    'AD_INVOICE'::text as source, -- noqa: RF04
    i.currency,
    null::text as market_key,
    l.campaign_id as reference_id,
    case when l.campaign_id is null then 'SELBOX' else 'CAMPAIGN' end as route,
    null::text as fnsku,
    null::text as asin,
    null::date as ledger_first_month,
    null::date as ledger_last_month,
    -l.base_amount as base_amount,
    -l.tax_amount as tax_amount,
    l.adjustment_kind
from private.ad_invoices as i
inner join private.ad_invoice_lines as l on i.version_id = l.version_id
union all
select
    version_id,
    id,
    'STORAGE' as source, -- noqa: RF04
    currency,
    marketplace_name as market_key,
    null as reference_id,
    'FNSKU' as route,
    fnsku,
    asin,
    ledger_first_month,
    ledger_last_month,
    -base_amount as base_amount,
    -tax_amount as tax_amount,
    null as adjustment_kind
from private.storage_rows
union all
select
    version_id,
    id,
    'AGED_STORAGE' as source, -- noqa: RF04
    currency,
    marketplace_name as market_key,
    null as reference_id,
    'FNSKU' as route,
    fnsku,
    asin,
    ledger_first_month,
    ledger_last_month,
    -base_amount as base_amount,
    -tax_amount as tax_amount,
    null as adjustment_kind
from private.aged_storage_rows
union all
select
    version_id,
    id,
    'REMOVAL_ORDER' as source, -- noqa: RF04
    currency,
    null as market_key,
    removal_order_id as reference_id,
    'FNSKU' as route,
    fnsku,
    null as asin,
    ledger_first_month,
    ledger_last_month,
    -base_amount as base_amount,
    -tax_amount as tax_amount,
    null as adjustment_kind
from private.removal_order_rows
where base_amount is not null;

create type private.financial_result as (
    source text,
    source_row_id uuid,
    source_version_id uuid,
    source_identity_id uuid,
    preprocess_version text,
    seller_namespace text,
    amazon_scope text,
    marketplace_name text,
    posted_date date,
    posted_at timestamptz,
    currency text,
    component_type text,
    route text,
    reference_id text,
    sku text,
    skus text [],
    fnsku text,
    asin text,
    base_amount numeric, tax_amount numeric, quantity numeric, fee_base numeric,
    outcome text,
    selbox_group text,
    reason text,
    company_id uuid,
    sku_id uuid,
    terms_version_id uuid,
    fee_period_id uuid,
    fee_rate_percent numeric,
    resolution_status text,
    fee_amount numeric,
    company_amount numeric,
    source_versions uuid [], assignment_versions uuid []
);

-- Select the same immutable headers for live and saved reads. Keeping the current
-- pointer join separate lets a date bound or a page limit drive the header scan.
create function private.selected_finance_headers(p_versions uuid[])
returns table (
    version_id uuid, transaction_id uuid, seller_namespace text, amazon_scope text,
    native_transaction_id text, preprocess_version text, marketplace_name text,
    posted_date date, posted_at timestamptz, currency text, is_activity boolean
) language sql stable as $$
    select u.version_id, u.unit_id, u.seller_namespace, u.amazon_scope, u.unit_key,
        u.preprocess_version, t.marketplace_name, t.posted_date, t.posted_at, t.currency, t.is_activity
    from private.selected_units(p_versions, true) u
    join private.finances_transactions t on t.version_id = u.version_id;
$$;

create function private.selected_assignments(p_versions uuid[])
returns table (
    key_id uuid, kind public.assignment_kind, native_id text, seller_namespace text,
    amazon_scope text, id uuid, company_id uuid
) language sql stable as $$
    select k.id::uuid, k.kind, k.native_id, k.seller_namespace, k.amazon_scope,
        v.id::uuid, v.company_id::uuid
    from public.assignment_keys k
    join public.assignment_versions v on v.id = k.current_version_id
    where p_versions is null
    union all
    select k.id::uuid, k.kind, k.native_id, k.seller_namespace, k.amazon_scope,
        v.id::uuid, v.company_id::uuid
    from public.assignment_versions v
    join public.assignment_keys k on k.id = v.key_id
    where p_versions is not null and v.id = any(p_versions);
$$;

-- Only direct SKU and account amounts have an outcome without a reference lookup.
create function private.direct_outcome(route private.finances_route, company_id uuid)
returns text language sql immutable parallel safe as $$
    select case when route = 'SELBOX' then 'SELBOX' when route = 'SKU' then
        case when company_id is null then 'DIFFERENCE' else 'COMPANY' end end;
$$;

-- A seller SKU or account charge has no invoice, order or ledger dependency.
-- Keep this path inlinable so the caller can filter the header, amount and owner
-- before joining fees or constructing provenance arrays.
create function private.direct_financial_amounts(
    p_source_versions uuid[], p_assignment_versions uuid[]
)
returns setof private.financial_result language sql stable as $$
    select 'FINANCES'::text, a.id::uuid, h.version_id, h.transaction_id,
        h.preprocess_version, h.seller_namespace, h.amazon_scope, h.marketplace_name,
        h.posted_date, h.posted_at, h.currency, a.amount_type::text, a.route::text,
        a.reference_id, a.sku, case when a.route = 'SKU' then array[a.sku] end, a.fnsku, a.asin,
        case when a.amount_part = 'TAX' then 0 else a.amount end,
        case when a.amount_part = 'TAX' then a.amount else 0 end,
        a.quantity::numeric, a.fee_base::numeric,
        private.direct_outcome(a.route, owner.company_id),
        a.selbox_group::text, case when a.route = 'SKU' and owner.company_id is null then 'NO_ASSIGNMENT' end,
        owner.company_id, owner.key_id, owner.id, p.id::uuid, p.fee_rate_percent,
        case when a.fee_base is null then 'NOT_APPLICABLE' when p.id is null then 'MISSING_FEE' else 'APPLIED' end,
        fee.amount, case when owner.company_id is not null then a.amount + fee.amount else 0 end,
        array[h.version_id], case when owner.id is null then '{}'::uuid[] else array[owner.id] end
    from private.selected_finance_headers(p_source_versions) h
    join private.finances_amounts a on a.version_id = h.version_id
    left join private.selected_assignments(p_assignment_versions) owner
        on a.route = 'SKU' and owner.kind = 'SKU' and owner.native_id = a.sku
    left join public.sku_fee_periods p on a.fee_base is not null and p.assignment_version_id = owner.id
        and p.marketplace_name = h.marketplace_name and p.valid_period @> h.posted_date
    cross join lateral (select case when a.fee_base is null then 0::numeric
        else private.calculate_service_fee(a.fee_base, p.fee_rate_percent) end as amount) fee
    where h.is_activity and a.route in ('SKU', 'SELBOX');
$$;

create function private.indirect_financial_amounts(
    p_source_versions uuid[], p_assignment_versions uuid[]
)
returns setof private.financial_result language sql stable as $$
    with units as materialized (
        select * from private.selected_units(p_source_versions, false)
    ),
    assignments as materialized (
        select * from private.selected_assignments(p_assignment_versions)
    ), activity as materialized (
        select h.*, a.id, a.amount_number as component_number, a.route::text as route,
            a.amount_type::text as component_type, a.reference_id, a.sku, a.fnsku, a.asin,
            a.quantity, a.ledger_first_month as ledger_start_month, a.ledger_last_month as ledger_end_month,
            case when a.route in ('STORAGE', 'AGED_STORAGE') then to_char(a.covered_month, 'YYYY-MM')
                when a.route in ('AD_INVOICE', 'REMOVAL_ORDER') then a.reference_id end as ref_key,
            case when a.route in ('STORAGE', 'AGED_STORAGE') then h.marketplace_name else '' end as market_key,
            case when a.amount_part = 'TAX' then 0 else a.amount end as base_amount,
            case when a.amount_part = 'TAX' then a.amount else 0 end as tax_amount
        from private.finances_amounts a
        join private.selected_finance_headers(p_source_versions) h using (version_id)
        where h.is_activity and a.route not in ('SKU', 'SELBOX')
    ), controls as materialized (
        select distinct on (seller_namespace,amazon_scope,route,ref_key,market_key,currency) c.*,
            sum(base_amount) over w charge_base,sum(tax_amount) over w charge_tax,array_agg(version_id::uuid) over w supporting
        from activity c where ref_key is not null
        window w as (partition by seller_namespace,amazon_scope,route,ref_key,market_key,currency
            order by posted_at,native_transaction_id collate "C",component_number rows between unbounded preceding and unbounded following)
        order by seller_namespace,amazon_scope,route,ref_key,market_key,currency,
            posted_at,native_transaction_id collate "C",component_number
    ), control_units as materialized (
        -- Resolve the account and native charge key before looking up any money rows.
        -- Joining invoice/report rows merely by currency creates a large intermediate set.
        select c.*, u.unit_id as reference_unit_id, u.version_id as reference_version_id,
            u.preprocess_version as reference_preprocess_version
        from controls c left join units u on u.source = c.route and u.unit_key = c.ref_key
            and u.seller_namespace = c.seller_namespace and u.amazon_scope = c.amazon_scope
    ), matched as materialized (
        select c.id as anchor_id, c.seller_namespace, c.amazon_scope, c.marketplace_name,
            c.posted_date, c.posted_at, c.currency, c.component_type, c.ref_key, c.supporting,
            c.route as source, c.reference_unit_id as unit_id, c.reference_version_id as version_id,
            c.reference_preprocess_version as preprocess_version, m.id as line_id, m.route,
            m.reference_id, m.fnsku, m.asin, m.ledger_first_month, m.ledger_last_month,
            m.base_amount, m.tax_amount, m.adjustment_kind
        from control_units c join private.reference_money m on m.version_id = c.reference_version_id
            and m.currency = c.currency and coalesce(m.market_key, '') = c.market_key
    ), sums as materialized (
        select anchor_id,sum(base_amount) base_amount,sum(tax_amount) tax_amount from matched group by 1
    ), inputs as (
        select 'FINANCES'::text source,id::uuid source_row_id,version_id::uuid source_version_id,transaction_id::uuid source_identity_id,
            preprocess_version,seller_namespace::text,amazon_scope::text,marketplace_name,posted_date,posted_at,currency,
            component_type::text,route,reference_id,sku,fnsku,asin,ledger_start_month,ledger_end_month,base_amount,tax_amount,
            quantity::numeric,null::text as selbox_group,null::text variance,array[version_id::uuid] as supporting
        from activity where ref_key is null
        union all
        select m.source,m.line_id,m.version_id,m.unit_id,m.preprocess_version,m.seller_namespace,m.amazon_scope,m.marketplace_name,
            m.posted_date,m.posted_at,m.currency,coalesce(m.adjustment_kind,m.component_type),m.route,
            coalesce(m.reference_id,m.ref_key),null,m.fnsku,m.asin,m.ledger_first_month,m.ledger_last_month,
            m.base_amount,m.tax_amount,null,case when m.route='SELBOX' then 'ACCOUNT_FEE' end,null,m.supporting||m.version_id
        from matched m
        union all
        select 'FINANCES',f.id,f.version_id,f.transaction_id,f.preprocess_version,f.seller_namespace,f.amazon_scope,f.marketplace_name,
            f.posted_date,f.posted_at,f.currency,f.component_type,f.route,f.ref_key,null,null,null,null,null,
            f.base_amount,f.tax_amount,null,null,'REFERENCE_NOT_FOUND',
            c.supporting || array[c.reference_version_id]::uuid[]
        from activity f join control_units c using(seller_namespace,amazon_scope,route,ref_key,market_key,currency)
        where not exists(select 1 from sums s where s.anchor_id=c.id)
        union all
        select 'KEY',c.id,c.version_id,c.transaction_id,c.preprocess_version,c.seller_namespace,c.amazon_scope,c.marketplace_name,
            c.posted_date,c.posted_at,c.currency,c.component_type,c.route,c.ref_key,null,null,null,null,null,
            x.base,x.tax,null,null,x.reason,c.supporting
        from controls c join sums s on s.anchor_id=c.id join private.currencies d on d.code=c.currency
        cross join lateral (values
            ('ROUNDING',round(s.base_amount,d.decimals)-s.base_amount,round(s.tax_amount,d.decimals)-s.tax_amount),
            ('TOTALS_DIFFER',c.charge_base-round(s.base_amount,d.decimals),c.charge_tax-round(s.tax_amount,d.decimals))
        ) x(reason,base,tax) where x.base<>0 or x.tax<>0
        union all
        select 'KEY',f.id,f.version_id,f.transaction_id,f.preprocess_version,f.seller_namespace,f.amazon_scope,location.market,
            location.day,location.instant,f.currency,f.component_type,f.route,f.ref_key,null,null,null,null,null,
            location.sign*f.base_amount,location.sign*f.tax_amount,null,null,'CHARGED_IN_ANOTHER_MONTH',c.supporting
        from activity f join controls c using(seller_namespace,amazon_scope,route,ref_key,market_key,currency)
        join sums s on s.anchor_id=c.id
        cross join lateral (values (1,f.marketplace_name,f.posted_date,f.posted_at),(-1,c.marketplace_name,c.posted_date,c.posted_at))
            location(sign,market,day,instant)
        where (date_trunc('month',f.posted_date),f.marketplace_name)<>(date_trunc('month',c.posted_date),c.marketplace_name)
            and (f.base_amount<>0 or f.tax_amount<>0)
    ), lookup_keys as materialized (
        -- Repeated report rows contribute separately. Resolve their common lookup once.
        select row_number() over () as lookup_id, keys.*
        from (
            select distinct seller_namespace, amazon_scope, route, ledger_start_month, ledger_end_month,
                case route when 'FNSKU' then fnsku when 'ASIN' then asin else reference_id end as code
            from inputs where variance is null and route in ('FNSKU', 'ASIN', 'CUSTOMER_ORDER')
        ) keys
    ), lookup_months as materialized (
        select k.lookup_id, m.month, u.version_id
        from lookup_keys k
        cross join lateral generate_series(k.ledger_start_month::timestamp,
            k.ledger_end_month::timestamp, interval '1 month') m(month)
        left join units u on u.source = 'INVENTORY_LEDGER'
            and u.seller_namespace = k.seller_namespace and u.amazon_scope = k.amazon_scope
            and u.unit_key = to_char(m.month, 'YYYY-MM')
    ), month_coverage as (
        select lookup_id, bool_or(version_id is null) as missing_month,
            array_agg(version_id order by month) filter (where version_id is not null) as version_ids
        from lookup_months group by lookup_id
    ), products as (
        select distinct k.lookup_id, l.sku, null::uuid as order_version
        from lookup_keys k join lookup_months m using (lookup_id)
        join private.inventory_ledger_rows l on l.version_id = m.version_id
            and l.seller_namespace = k.seller_namespace and l.amazon_scope = k.amazon_scope
            and l.month = m.month::date
            and (case k.route when 'FNSKU' then l.fnsku when 'ASIN' then l.asin end) = k.code
        union all
        select distinct k.lookup_id, a.sku, t.version_id::uuid
        from lookup_keys k join private.finances_transactions t on t.customer_order_id = k.code
        join private.source_unit_versions v on v.id = t.version_id
        join private.source_units u on u.id = v.unit_id and u.seller_namespace = k.seller_namespace
            and u.amazon_scope = k.amazon_scope
        join private.finances_amounts a on a.version_id = t.version_id and a.route = 'SKU'
        where k.route = 'CUSTOMER_ORDER' and case when p_source_versions is null
            then t.version_id = u.current_version_id else t.version_id = any(p_source_versions) end
    ), product_owners as (
        select p.lookup_id, array_agg(distinct p.sku order by p.sku) as skus,
            count(distinct a.company_id) as owner_count, count(p.sku) > count(a.company_id) as unassigned,
            min(a.company_id::text)::uuid as owner,
            array_agg(distinct p.order_version order by p.order_version)
                filter (where p.order_version is not null) as order_versions,
            array_agg(distinct a.id order by a.id) filter (where a.id is not null) as assignment_ids
        from products p left join assignments a on a.kind = 'SKU' and a.native_id = p.sku
        group by p.lookup_id
    ), lookups as materialized (
        select k.*, o.skus, o.assignment_ids,
            case when o.owner_count = 1 and not o.unassigned then o.owner end as company_id,
            coalesce(m.version_ids, '{}'::uuid[]) || coalesce(o.order_versions, '{}'::uuid[]) as source_ids,
            case when o.owner_count > 1 then 'SPLIT_OWNERSHIP'
                when o.unassigned then 'NO_ASSIGNMENT'
                when o.skus is not null then null
                when k.route = 'CUSTOMER_ORDER' then 'REFERENCE_NOT_FOUND'
                when m.missing_month then 'LEDGER_MONTH_NOT_LOADED'
                else 'NOT_IN_LEDGER' end as reason
        from lookup_keys k left join product_owners o using (lookup_id)
        left join month_coverage m using (lookup_id)
    ), resolved as (
        select i.*, q.skus as resolved_skus, coalesce(a.company_id, q.company_id)::uuid as owner,
            case when i.variance is not null then i.variance
                when i.route='SELBOX' or coalesce(a.company_id,q.company_id) is not null then null
                when i.route in ('PROMOTION','SHIPMENT','CAMPAIGN') then
                    case when i.reference_id is null then 'NO_ID_ON_CHARGE' else 'NO_ASSIGNMENT' end
                when i.route in ('AD_INVOICE','REMOVAL_ORDER') and i.reference_id is null then 'NO_ID_ON_CHARGE'
                else q.reason end reason,
            coalesce(q.source_ids,'{}') || i.supporting deps,
            case when a.id is not null then array[a.id::uuid] else coalesce(q.assignment_ids,'{}') end owners
        from inputs i
        left join assignments a on i.variance is null and a.kind::text = i.route
            and a.native_id = i.reference_id and a.seller_namespace = i.seller_namespace
            and a.amazon_scope = i.amazon_scope
        left join lookups q on i.variance is null and q.route = i.route
            and q.seller_namespace = i.seller_namespace and q.amazon_scope = i.amazon_scope
            and q.code = case i.route when 'FNSKU' then i.fnsku
                when 'ASIN' then i.asin else i.reference_id end
            and q.ledger_start_month is not distinct from i.ledger_start_month
            and q.ledger_end_month is not distinct from i.ledger_end_month
    )
    select r.source,r.source_row_id,r.source_version_id,r.source_identity_id,r.preprocess_version,r.seller_namespace,r.amazon_scope,
        r.marketplace_name,r.posted_date,r.posted_at,r.currency,r.component_type,r.route,r.reference_id,
        coalesce(r.sku,case when cardinality(r.resolved_skus)=1 then r.resolved_skus[1] end),r.resolved_skus,r.fnsku,r.asin,
        r.base_amount,r.tax_amount,r.quantity,null::numeric,
        case when r.reason is not null then 'DIFFERENCE' when r.route='SELBOX' then 'SELBOX' else 'COMPANY' end,
        r.selbox_group,r.reason,r.owner,null::uuid,null::uuid,null::uuid,null::numeric,
        'NOT_APPLICABLE'::text,0::numeric,
        case when r.owner is not null then r.base_amount+r.tax_amount else 0 end,r.deps,r.owners
    from resolved r;
$$;

create function private.calculate_amounts(p_source_versions uuid[], p_assignment_versions uuid[])
returns setof private.financial_result language sql stable as $$
    select * from private.direct_financial_amounts(p_source_versions, p_assignment_versions)
    union all
    select * from private.indirect_financial_amounts(p_source_versions, p_assignment_versions);
$$;

create view private.financial_outcomes with (security_invoker = true) as
select * from private.calculate_amounts(null, null); -- noqa: AM04

create function private.read_financial_outcomes() returns setof private.financial_result
language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    return query select * from private.financial_outcomes;
end;
$$;
create view public.financial_outcomes with (security_invoker = true) as
select
    source,
    source_row_id,
    source_version_id,
    seller_namespace,
    amazon_scope,
    marketplace_name,
    currency,
    posted_date,
    component_type,
    outcome,
    selbox_group,
    reason,
    reference_id,
    sku,
    to_jsonb(skus) as skus,
    fnsku,
    asin,
    base_amount,
    tax_amount,
    company_id
from private.read_financial_outcomes();

-- Count every native activity amount in the control. Direct SKU and account
-- charges also supply their outcome here; the remaining outcomes come from
-- invoice, warehouse, named-assignment and order lookups.
create view private.monthly_financial_totals with (security_invoker = true) as
with contributions as (
    select
        h.seller_namespace,
        h.amazon_scope,
        h.marketplace_name,
        h.currency,
        date_trunc('month', h.posted_date)::date as month, -- noqa: RF04
        true as native,
        private.direct_outcome(a.route, terms.company_id) as outcome,
        case when a.amount_part = 'TAX' then 0 else a.amount end as base_amount,
        case when a.amount_part = 'TAX' then a.amount else 0 end as tax_amount
    from private.selected_finance_headers(null) as h
    inner join private.finances_amounts as a on h.version_id = a.version_id
    left join private.current_sku_terms as terms on a.route = 'SKU' and a.sku = terms.sku
    where h.is_activity
    union all
    select
        seller_namespace,
        amazon_scope,
        marketplace_name,
        currency,
        date_trunc('month', posted_date)::date as month, -- noqa: RF04
        false as native,
        outcome,
        base_amount,
        tax_amount
    from private.indirect_financial_amounts(null, null)
)

select
    seller_namespace,
    amazon_scope,
    marketplace_name,
    currency,
    month,
    coalesce(sum(base_amount) filter (where native), 0) as finances_base,
    coalesce(sum(tax_amount) filter (where native), 0) as finances_tax,
    coalesce(sum(base_amount) filter (where outcome = 'COMPANY'), 0) as company_base,
    coalesce(sum(tax_amount) filter (where outcome = 'COMPANY'), 0) as company_tax,
    coalesce(sum(base_amount) filter (where outcome = 'SELBOX'), 0) as selbox_base,
    coalesce(sum(tax_amount) filter (where outcome = 'SELBOX'), 0) as selbox_tax,
    coalesce(sum(base_amount) filter (where outcome = 'DIFFERENCE'), 0) as difference_base,
    coalesce(sum(tax_amount) filter (where outcome = 'DIFFERENCE'), 0) as difference_tax
from contributions
group by 1, 2, 3, 4, 5;

create function private.read_monthly_financial_totals()
returns setof private.monthly_financial_totals
language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    return query select * from private.monthly_financial_totals;
end;
$$;
create view public.financial_review_monthly with (security_invoker = true) as
select * from private.read_monthly_financial_totals(); -- noqa: AM04

create view private.company_components with (security_invoker = true) as
select
    source,
    source_row_id,
    source_version_id,
    preprocess_version,
    source_identity_id,
    seller_namespace,
    marketplace_name,
    posted_date as activity_date,
    posted_at as activity_at,
    sku,
    component_type,
    currency,
    base_amount + tax_amount as source_amount,
    base_amount,
    tax_amount,
    quantity,
    fee_base,
    outcome,
    selbox_group,
    sku_id,
    terms_version_id,
    company_id,
    fee_period_id,
    fee_rate_percent,
    resolution_status,
    fee_amount,
    company_amount
from private.financial_outcomes
where outcome in ('COMPANY', 'SELBOX');

-- Resolve the session's permitted companies once, before opening a read plan.
-- NULL means all companies (and SelBox); an empty array means no visible rows.
create function private.transaction_company_scope(p_companies uuid[])
returns uuid[] language sql stable security invoker set search_path = '' as $$
    select case
        when private.is_administrator() or pg_has_role(
            coalesce(nullif(current_setting('role', true), 'none'), session_user::text)::name,
            (select relowner from pg_class where oid='public.app_accounts'::regclass), 'USAGE'
        ) then nullif(p_companies, '{}'::uuid[])
        else array(
            select a.company_id::uuid from public.app_accounts a
            where a.user_id=(select auth.uid()) and a.access_role='member'
                and (coalesce(cardinality(p_companies), 0)=0 or a.company_id=any(p_companies))
        )
    end;
$$;

-- The calculation can inspect all candidate owners. Only the caller's completed
-- company allocations cross the definer boundary.
create function private.visible_company_components(
    p_date_from date default null, p_date_to date default null, p_marketplaces text[] default null,
    p_currency text default null, p_companies uuid[] default null
) returns setof private.company_components
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare companies uuid[] := private.transaction_company_scope(p_companies);
begin
    if cardinality(companies)=0 then return; end if;
    return query select c.* from private.company_components c
    where (companies is null or c.company_id=any(companies))
        and (p_date_from is null or c.activity_at>=p_date_from::timestamp at time zone 'UTC')
        and (p_date_to is null or c.activity_at<(p_date_to+1)::timestamp at time zone 'UTC')
        and (p_currency is null or c.currency=p_currency)
        and (coalesce(cardinality(p_marketplaces),0)=0 or c.marketplace_name=any(p_marketplaces));
end;
$$;
create view public.live_company_components with (security_invoker = true) as
select * from private.visible_company_components(); -- noqa: AM04
