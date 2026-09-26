-- Keep expensive aggregation behind date-bounded, explicitly authorized RPCs.
-- Pre-aggregate compatible facts before current fee lookup; numeric arithmetic
-- remains exact and groups with missing ownership/rates preserve SQL NULL sums.
create function public.transaction_totals(
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_currency text default null,
    p_group_by_type boolean default false,
    p_limit integer default 1000,
    p_offset bigint default 0
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    settlement_policy_is_sufficient boolean;
    kiosk_policy_is_sufficient boolean;
begin
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_require_date => true
    );
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter uppercase code' using errcode = '22023';
    end if;
    if p_group_by_type is null then
        raise exception 'Grouping preference is required' using errcode = '22023';
    end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    -- The unchanged fact RLS already requires current versions for members.
    -- Operators, owners, and bypass contexts still use the explicit pointer check.
    settlement_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.settlement_transactions'::regclass
    );
    kiosk_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.data_kiosk_transactions'::regclass
    );
    return (
        with facts as (
            select t.seller_namespace, t.sku, t.marketplace_name,
                t.posted_date as activity_date, t.currency,
                case when p_group_by_type then t.component_type::text end as component_type,
                t.amount::numeric as reported_amount,
                case when private.settlement_fee_applicable(
                    t.transaction_type, t.amount_type, t.amount_description
                ) then t.amount::numeric end as fee_base
            from private.settlement_transactions as t
            where t.category = 'SETTLEMENT'
                and (settlement_policy_is_sufficient or exists (
                    select 1 from private.settlements as h where h.current_version_id = t.version_id
                ))
                and (p_date_from is null or t.posted_date >= p_date_from)
                and (p_date_to is null or t.posted_date <= p_date_to)
                and (coalesce(cardinality(p_company_ids), 0) = 0 or exists (
                    select 1 from public.company_skus as o
                    where o.seller_namespace = t.seller_namespace and o.sku = t.sku
                        and o.company_id = any(p_company_ids)
                ))
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (p_currency is null or t.currency = p_currency)
            union all
            select t.seller_namespace, t.sku, t.marketplace_name, t.activity_date, t.currency,
                case when p_group_by_type then t.component_type::text end,
                t.amount::numeric, t.fee_base::numeric
            from private.data_kiosk_transactions as t
            where t.amount <> 0
                and (kiosk_policy_is_sufficient or exists (
                    select 1 from private.data_kiosk_days as h where h.current_version_id = t.version_id
                ))
                and (p_date_from is null or t.activity_date >= p_date_from)
                and (p_date_to is null or t.activity_date <= p_date_to)
                and (coalesce(cardinality(p_company_ids), 0) = 0 or exists (
                    select 1 from public.company_skus as o
                    where o.seller_namespace = t.seller_namespace and o.sku = t.sku
                        and o.company_id = any(p_company_ids)
                ))
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (p_currency is null or t.currency = p_currency)
        ),
        fact_groups as materialized (
            select f.seller_namespace, f.sku, f.marketplace_name, f.activity_date,
                f.currency, f.component_type, f.fee_base is not null as fee_applicable,
                sum(f.reported_amount) as reported_amount, sum(f.fee_base) as fee_base,
                count(*)::numeric as row_count
            from facts as f
            group by f.seller_namespace, f.sku, f.marketplace_name, f.activity_date,
                f.currency, f.component_type, f.fee_base is not null
        ),
        selected_terms as materialized (
            select seller_namespace, sku, terms_version_id, company_id
            from private.current_sku_terms
        ),
        calculated as (
            select g.currency, g.component_type, g.reported_amount, g.row_count,
                case when o.company_id is null then null
                    when not g.fee_applicable then 0::numeric
                    when p.id is not null
                        then private.calculate_service_fee(g.fee_base, p.fee_rate_percent)
                end as service_fee
            from fact_groups as g
            left join selected_terms as o
                on g.seller_namespace = o.seller_namespace and g.sku = o.sku
            left join public.sku_fee_periods as p
                on o.terms_version_id = p.terms_version_id
                    and g.marketplace_name = p.marketplace_name
                    and p.valid_period @> g.activity_date
                    and g.fee_applicable and o.company_id is not null
        ),
        totals as (
            select c.currency, c.component_type,
                sum(c.reported_amount) as reported_amount,
                sum(c.service_fee) as service_fee,
                sum(c.reported_amount + c.service_fee) as company_amount,
                sum(c.row_count) as row_count,
                sum(case when c.service_fee is not null then c.row_count else 0 end)
                    as known_company_count
            from calculated as c
            group by c.currency, c.component_type
        ),
        selected as materialized (
            select t.* from totals as t
            order by t.currency collate "C", t.component_type collate "C" nulls first
            limit p_limit + 1 offset p_offset
        ),
        page as (
            select s.* from selected as s
            order by s.currency collate "C", s.component_type collate "C" nulls first
            limit p_limit
        )
        select jsonb_build_object(
            'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'currency', p.currency, 'component_type', p.component_type,
                'reported_amount', p.reported_amount::text, 'service_fee', p.service_fee::text,
                'company_amount', p.company_amount::text, 'row_count', p.row_count::text,
                'known_company_count', p.known_company_count::text
            ) order by p.currency collate "C", p.component_type collate "C" nulls first)
                from page as p), '[]'::jsonb),
            'next_offset', case when (select count(*) from selected) > p_limit
                then p_offset + p_limit end
        )
    );
end;
$$;
revoke all on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean, integer, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean, integer, bigint
) to authenticated;
