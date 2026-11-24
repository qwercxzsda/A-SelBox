-- Preserve the row types consumed by RPCs and the positional UNION branches.
-- noqa: disable=ST06
-- Version selections are shared by live screens and immutable payout replay.
-- Null selects current pointers. An empty array deliberately selects no versions.
create function private.selected_units(p_versions uuid[])
returns table (
    unit_id uuid, version_id uuid, source text, seller_namespace text,
    amazon_scope text, unit_key text, preprocess_version text
)
language sql stable as $$
    select u.id::uuid,u.current_version_id::uuid,u.source::text,u.seller_namespace::text,
        u.amazon_scope::text,u.unit_key::text,b.preprocess_version::text
    from private.source_units u join private.source_preprocess_batches b on b.id=u.current_batch_id
    where p_versions is null
    union all
    select u.id::uuid,v.id::uuid,u.source::text,u.seller_namespace::text,u.amazon_scope::text,
        u.unit_key::text,b.preprocess_version::text
    from private.source_unit_versions v join private.source_units u on u.id=v.unit_id
    cross join lateral (
        select b.preprocess_version from private.source_batch_units m
        join private.source_preprocess_batches b on b.id=m.batch_id
        where m.version_id=v.id order by b.created_at,b.id limit 1
    ) b where v.id=any(p_versions);
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

create function private.calculate_amounts(p_source_versions uuid[], p_assignment_versions uuid[])
returns setof private.financial_result language sql stable as $$
    with units as materialized (
        select * from private.selected_units(p_source_versions) where source <> 'FINANCES'
    ),
    assignments as materialized (
        select k.id as key_id,k.kind::text,k.native_id,k.seller_namespace,k.amazon_scope,v.id,v.company_id
        from public.assignment_keys k join public.assignment_versions v on v.key_id=k.id
        and case when p_assignment_versions is null then v.id=k.current_version_id else v.id=any(p_assignment_versions) end
    ), finances as not materialized (
        select f.*,b.preprocess_version::text
        from private.finances_component_details f
        join private.source_preprocess_batches b on b.id=f.current_batch_id
        where p_source_versions is null and f.is_current
        union all
        select f.*,u.preprocess_version from private.finances_component_details f
        join private.selected_units(p_source_versions) u using(version_id)
        where p_source_versions is not null and u.source='FINANCES'
    ), activity as not materialized (
        select f.*,case when route in ('AD_INVOICE','REMOVAL_ORDER','STORAGE','AGED_STORAGE') then route end ref_source,
            case when route in ('STORAGE','AGED_STORAGE') then to_char(reference_month,'YYYY-MM') else reference_id end ref_key,
            case when route in ('STORAGE','AGED_STORAGE') then marketplace_name else '' end market_key,
            case when amount_part='TAX' then 0 else amount end base_amount,
            case when amount_part='TAX' then amount else 0 end tax_amount
        from finances f where activity_eligible
    ), charges as materialized (
        select * from activity where ref_source is not null and ref_key is not null
    ), controls as materialized (
        select distinct on (seller_namespace,amazon_scope,ref_source,ref_key,market_key,currency) c.*,
            sum(base_amount) over w charge_base,sum(tax_amount) over w charge_tax,array_agg(version_id::uuid) over w supporting
        from charges c where ref_key is not null and ref_source is not null
        window w as (partition by seller_namespace,amazon_scope,ref_source,ref_key,market_key,currency
            order by posted_at,native_transaction_id collate "C",component_number rows between unbounded preceding and unbounded following)
        order by seller_namespace,amazon_scope,ref_source,ref_key,market_key,currency,
            posted_at,native_transaction_id collate "C",component_number
    ), matched as materialized (
        select c.id anchor_id,c.seller_namespace,c.amazon_scope,c.marketplace_name,c.posted_date,c.posted_at,c.currency,
            c.component_type,c.ref_key,c.supporting,u.source,u.unit_id,u.version_id,u.preprocess_version,m.id as line_id,m.route,m.reference_id,m.fnsku,m.asin,
            m.ledger_first_month,m.ledger_last_month,m.base_amount,m.tax_amount,m.adjustment_kind
        from controls c join units u on u.source=c.ref_source and u.unit_key=c.ref_key
            and u.seller_namespace=c.seller_namespace and u.amazon_scope=c.amazon_scope
        join private.reference_money m on m.version_id=u.version_id and m.currency=c.currency
            and coalesce(m.market_key,'')=c.market_key
    ), sums as materialized (
        select anchor_id,sum(base_amount) base_amount,sum(tax_amount) tax_amount from matched group by 1
    ), inputs as (
        select 'FINANCES'::text source,id::uuid source_row_id,version_id::uuid source_version_id,transaction_id::uuid source_identity_id,
            preprocess_version,seller_namespace::text,amazon_scope::text,marketplace_name,posted_date,posted_at,currency,
            component_type::text,route,reference_id,sku,fnsku,asin,ledger_start_month,ledger_end_month,base_amount,tax_amount,
            quantity::numeric,fee_base::numeric,selbox_group,null::text variance,array[version_id::uuid] as supporting
        from activity where ref_source is null or ref_key is null
        union all
        select m.source,m.line_id,m.version_id,m.unit_id,m.preprocess_version,m.seller_namespace,m.amazon_scope,m.marketplace_name,
            m.posted_date,m.posted_at,m.currency,coalesce(m.adjustment_kind,m.component_type),m.route,
            coalesce(m.reference_id,m.ref_key),null,m.fnsku,m.asin,m.ledger_first_month,m.ledger_last_month,
            m.base_amount,m.tax_amount,null,null,case when m.route='SELBOX' then 'ACCOUNT_FEE' end,null,m.supporting||m.version_id
        from matched m
        union all
        select 'FINANCES',f.id,f.version_id,f.transaction_id,f.preprocess_version,f.seller_namespace,f.amazon_scope,f.marketplace_name,
            f.posted_date,f.posted_at,f.currency,f.component_type,f.route,f.ref_key,null,null,null,null,null,
            f.base_amount,f.tax_amount,null,null,null,'REFERENCE_NOT_FOUND',
            c.supporting || coalesce(array[u.version_id]::uuid[], '{}'::uuid[])
        from charges f join controls c using(seller_namespace,amazon_scope,ref_source,ref_key,market_key,currency)
        left join units u on u.source=c.ref_source and u.unit_key=c.ref_key and u.seller_namespace=c.seller_namespace and u.amazon_scope=c.amazon_scope
        where not exists(select 1 from sums s where s.anchor_id=c.id)
        union all
        select 'KEY',c.id,c.version_id,c.transaction_id,c.preprocess_version,c.seller_namespace,c.amazon_scope,c.marketplace_name,
            c.posted_date,c.posted_at,c.currency,c.component_type,c.route,c.ref_key,null,null,null,null,null,
            x.base,x.tax,null,null,null,x.reason,c.supporting
        from controls c join sums s on s.anchor_id=c.id join private.currencies d on d.code=c.currency
        cross join lateral (values
            ('ROUNDING',round(s.base_amount,d.decimals)-s.base_amount,round(s.tax_amount,d.decimals)-s.tax_amount),
            ('TOTALS_DIFFER',c.charge_base-round(s.base_amount,d.decimals),c.charge_tax-round(s.tax_amount,d.decimals))
        ) x(reason,base,tax) where x.base<>0 or x.tax<>0
        union all
        select 'KEY',f.id,f.version_id,f.transaction_id,f.preprocess_version,f.seller_namespace,f.amazon_scope,location.market,
            location.day,location.instant,f.currency,f.component_type,f.route,f.ref_key,null,null,null,null,null,
            location.sign*f.base_amount,location.sign*f.tax_amount,null,null,null,'CHARGED_IN_ANOTHER_MONTH',c.supporting
        from charges f join controls c using(seller_namespace,amazon_scope,ref_source,ref_key,market_key,currency)
        join sums s on s.anchor_id=c.id
        cross join lateral (values (1,f.marketplace_name,f.posted_date,f.posted_at),(-1,c.marketplace_name,c.posted_date,c.posted_at))
            location(sign,market,day,instant)
        where (date_trunc('month',f.posted_date),f.marketplace_name)<>(date_trunc('month',c.posted_date),c.marketplace_name)
            and (f.base_amount<>0 or f.tax_amount<>0)
    ), ledger as materialized (
        select u.version_id,u.seller_namespace,u.amazon_scope,u.unit_key,l.sku,l.fnsku,l.asin
        from units u left join private.inventory_ledger_rows l using(version_id) where u.source='INVENTORY_LEDGER'
    ), resolved as (
        select i.*,coalesce(q.skus,case when i.route='SKU' then array[i.sku] end) resolved_skus,
            coalesce(a.company_id,q.company_id)::uuid owner,
            case when i.route='SKU' then a.key_id::uuid end sku_id,
            case when i.route='SKU' then a.id::uuid end terms_version_id,
            case when i.variance is not null then i.variance
                when i.route='SELBOX' or coalesce(a.company_id,q.company_id) is not null then null
                when i.route in ('SKU','PROMOTION','SHIPMENT','CAMPAIGN') then
                    case when i.route<>'SKU' and i.reference_id is null then 'NO_ID_ON_CHARGE' else 'NO_ASSIGNMENT' end
                when i.route in ('AD_INVOICE','REMOVAL_ORDER') and i.reference_id is null then 'NO_ID_ON_CHARGE'
                else q.reason end reason,
            coalesce(q.source_ids,'{}') || i.supporting deps,
            case when a.id is not null then array[a.id::uuid] else coalesce(q.assignment_ids,'{}') end owners
        from inputs i
        left join assignments a on i.variance is null and a.kind=i.route
            and a.native_id=case when i.route='SKU' then i.sku else i.reference_id end
            and coalesce(a.seller_namespace,'')=case when i.route='SKU' then '' else i.seller_namespace end
            and coalesce(a.amazon_scope,'')=case when i.route='SKU' then '' else i.amazon_scope end
        left join lateral (
            with months as (
                select u.version_id from generate_series(i.ledger_start_month::timestamp,i.ledger_end_month::timestamp,interval '1 month') d
                left join units u on u.source='INVENTORY_LEDGER' and u.seller_namespace=i.seller_namespace
                    and u.amazon_scope=i.amazon_scope and u.unit_key=to_char(d,'YYYY-MM')
            ), products as (
                select distinct l.sku,null::uuid order_version from ledger l join months m using(version_id)
                    where (i.route='ASIN' and l.asin=i.asin) or (i.route='FNSKU' and l.fnsku=i.fnsku)
                union all
                select f.sku,f.version_id from private.finances_component_details f
                    where i.route='CUSTOMER_ORDER' and f.route='SKU'
                    and case when p_source_versions is null then f.is_current else f.version_id=any(p_source_versions) end
                    and f.seller_namespace=i.seller_namespace and f.amazon_scope=i.amazon_scope and f.order_id=i.reference_id
            )
            select array_agg(distinct p.sku order by p.sku) skus,
                case when count(*)=count(a.company_id) and count(distinct a.company_id)=1 then min(a.company_id::text)::uuid end company_id,
                case when count(distinct a.company_id)>1 then 'SPLIT_OWNERSHIP'
                    when count(*)>count(a.company_id) then 'NO_ASSIGNMENT'
                    when count(*)>0 then null when i.route='CUSTOMER_ORDER' then 'REFERENCE_NOT_FOUND'
                    when exists(select 1 from months where version_id is null) then 'LEDGER_MONTH_NOT_LOADED'
                    else 'NOT_IN_LEDGER' end reason,
                array(select version_id from months where version_id is not null)
                    || coalesce(array_agg(distinct order_version) filter(where order_version is not null),'{}') source_ids,
                array_agg(distinct a.id::uuid) filter(where a.id is not null) assignment_ids
            from products p left join assignments a on a.kind='SKU' and a.native_id=p.sku
            having i.variance is null and i.route in ('FNSKU','ASIN','CUSTOMER_ORDER')
        ) q on true
    )
    select r.source,r.source_row_id,r.source_version_id,r.source_identity_id,r.preprocess_version,r.seller_namespace,r.amazon_scope,
        r.marketplace_name,r.posted_date,r.posted_at,r.currency,r.component_type,r.route,r.reference_id,
        coalesce(r.sku,case when cardinality(r.resolved_skus)=1 then r.resolved_skus[1] end),r.resolved_skus,r.fnsku,r.asin,
        r.base_amount,r.tax_amount,r.quantity,r.fee_base,
        case when r.reason is not null then 'DIFFERENCE' when r.route='SELBOX' then 'SELBOX' else 'COMPANY' end,
        r.selbox_group,r.reason,r.owner,r.sku_id,r.terms_version_id,p.id::uuid,p.fee_rate_percent,
        case when r.fee_base is null then 'NOT_APPLICABLE' when p.id is null then 'MISSING_FEE' else 'APPLIED' end,
        fee.amount,case when r.owner is not null then r.base_amount+r.tax_amount+fee.amount else 0 end,r.deps,r.owners
    from resolved r left join public.sku_fee_periods p on p.assignment_version_id=r.terms_version_id
        and p.marketplace_name=r.marketplace_name and p.valid_period @> r.posted_date and r.fee_base is not null
    cross join lateral(select case when r.fee_base is null then 0::numeric else private.calculate_service_fee(r.fee_base,p.fee_rate_percent) end amount) fee;
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

create view private.monthly_financial_totals with (security_invoker = true) as
with contributions as (
    select
        seller_namespace,
        amazon_scope,
        marketplace_name,
        currency,
        posted_date,
        'FINANCES' as outcome,
        case when amount_part = 'TAX' then 0 else amount end as base_amount,
        case when amount_part = 'TAX' then amount else 0 end as tax_amount
    from private.finances_component_details
    where is_current and activity_eligible
    union all
    select
        seller_namespace,
        amazon_scope,
        marketplace_name,
        currency,
        posted_date,
        outcome,
        base_amount,
        tax_amount
    from private.financial_outcomes
)

select
    seller_namespace,
    amazon_scope,
    marketplace_name,
    currency,
    date_trunc('month', posted_date)::date as month, -- noqa: RF04
    coalesce(sum(base_amount) filter (where outcome = 'FINANCES'), 0) as finances_base,
    coalesce(sum(tax_amount) filter (where outcome = 'FINANCES'), 0) as finances_tax,
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

-- Ownership requires seeing every candidate SKU, including another company's
-- SKUs. Resolve against the complete inputs first, then expose only the caller's
-- company. Company identifiers are obtained from the caller's registered account.
create function private.visible_company_components(
    p_date_from date default null, p_date_to date default null, p_marketplaces text[] default null,
    p_currency text default null, p_companies uuid[] default null
) returns setof private.company_components
language sql stable security definer set search_path = '' as $$
    select c.* from private.company_components c
    where (p_date_from is null or c.activity_at>=p_date_from::timestamp at time zone 'UTC')
        and (p_date_to is null or c.activity_at<(p_date_to+1)::timestamp at time zone 'UTC')
        and (p_currency is null or c.currency=p_currency)
        and (coalesce(cardinality(p_marketplaces),0)=0 or c.marketplace_name=any(p_marketplaces))
        and (coalesce(cardinality(p_companies),0)=0 or c.company_id=any(p_companies))
        and (exists(select 1 from public.app_accounts a where a.user_id=auth.uid() and
        (a.access_role='administrator' or (a.access_role='member' and a.company_id=c.company_id)))
        or pg_has_role(coalesce(nullif(current_setting('role',true),'none'),session_user::text)::name,
            (select relowner from pg_class where oid='public.app_accounts'::regclass),'USAGE'));
$$;
create view public.live_company_components with (security_invoker = true) as
select * from private.visible_company_components(); -- noqa: AM04
