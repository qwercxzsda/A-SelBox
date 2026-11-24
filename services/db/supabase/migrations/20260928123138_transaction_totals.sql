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
    p_sources text[] default null,
    p_types text[] default null,
    p_fee_applicable boolean default null,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null,
    p_search_sources text[] default null,
    p_granularity text default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
-- Favor hash grouping within the caller's memory limits. JSON ordering stays in
-- its ordered aggregate, without a disabled-sort cost penalty. Caller memory
-- limits are inherited, and these planner preferences end with this function.
set enable_sort = 'off'
set enable_presorted_aggregate = 'off' as $$
declare
    result jsonb;
begin
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_sources, p_types, p_require_date => true
    );
    perform private.validate_transaction_filters(
        null, null, null, p_search_skus, p_search_marketplaces,
        p_search_sources, p_search_types
    );
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter uppercase code' using errcode = '22023';
    end if;
    if p_group_by_type is null then
        raise exception 'Grouping preference is required' using errcode = '22023';
    end if;
    if p_granularity is not null and p_granularity not in ('day', 'week') then
        raise exception 'Trend granularity must be day or week' using errcode = '22023';
    end if;
    result:=(
        with totals as (
            select case when not p_group_by_type or p_granularity is not null then c.marketplace_name end as marketplace_name,
                c.currency,case when p_group_by_type or p_granularity is not null then c.component_type end as component_type,
                date_trunc(p_granularity,c.activity_at at time zone 'UTC')::date as period_start,
                sum(c.source_amount) as reported_amount,sum(c.fee_amount) as service_fee,sum(c.company_amount) as company_amount,
                count(*) as row_count,count(c.company_amount) as known_company_count
            from private.filtered_components(p_date_from,p_date_to,p_company_ids,p_skus,p_marketplaces,p_sources,p_types,p_fee_applicable,p_search_skus,p_search_types,p_search_marketplaces,p_search_sources,p_currency) c group by 1,2,3,4
        ),
        bounded_groups as materialized (
            select t.* from totals as t
            limit 100001
        ),
        group_count as materialized (
            select count(*) as value from bounded_groups
        )
        select jsonb_build_object(
            'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'marketplace_name', p.marketplace_name,
                'currency', p.currency, 'component_type', p.component_type,
                'period_start', p.period_start,
                'reported_amount', p.reported_amount::text, 'service_fee', p.service_fee::text,
                'company_amount', p.company_amount::text, 'row_count', p.row_count::text,
                'known_company_count', p.known_company_count::text
            ) order by p.marketplace_name collate "C" nulls first,
                p.currency collate "C", p.period_start nulls first,
                p.component_type collate "C" nulls first)
                from bounded_groups as p
                where (select value from group_count) <= 100000), '[]'::jsonb),
            'group_count', (select value::text from group_count)
        )
    );
    if (result ->> 'group_count')::bigint > 100000 then
        raise exception 'Transaction totals exceed 100000 groups; select a shorter date range or narrower filters'
            using errcode = '22023',
                detail = '{"code":"TRANSACTION_TOTAL_GROUP_LIMIT","limit":100000}';
    end if;
    return result;
end;
$$;
revoke all on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean,
    text[], text[], boolean, text[], text[], text[], text[], text
) from public, anon, authenticated, service_role;

-- Derived records use saved inputs and report authorization. Numeric/boolean
-- fields are text in JSON, matching the application's exact-value row contract.
create function public.payout_report_records(
    p_report_id uuid,
    p_limit integer default 50, p_offset bigint default 0, p_types text[] default null
) returns jsonb language plpgsql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if p_report_id is null then
        raise exception 'Report and record scope are required' using errcode='22023';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    perform private.validate_transaction_filters(null,null,null,null,null,null,p_types);
    return (
        with records as materialized (
            select r.* from private.read_payout_report_records(p_report_id) r
            where (coalesce(cardinality(p_types),0)=0 or r.component_type=any(p_types))
        ), page as (
            select * from records
            order by activity_date desc,source desc,source_row_id desc
            limit p_limit offset p_offset
        )
        select jsonb_build_object(
            'rows',coalesce((select jsonb_agg(
                (select jsonb_object_agg(key,value) from jsonb_each_text(to_jsonb(p)))
                order by p.activity_date desc,p.source desc,p.source_row_id desc)
                from page p),'[]'::jsonb),
            'total_count',(select count(*)::text from records))
    );
end;
$$;

-- Grand totals remain the saved report values. Type breakdowns are derived from
-- the same immutable inputs; neither path uses current ownership or source pointers.
create function public.payout_report_totals(
    p_report_id uuid,
    p_group_by_type boolean default false,
    p_limit integer default 1000,
    p_offset bigint default 0
) returns jsonb
language plpgsql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare report public.company_payout_reports;
begin
    if p_report_id is null or p_group_by_type is null then
        raise exception 'Report and grouping preference are required' using errcode = '22023';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    select * into report from public.company_payout_reports r where r.id=p_report_id;
    if not found then raise exception 'Report access required' using errcode='42501'; end if;
    return (
        with totals as (
            select report.currency,
                case when p_group_by_type then c.component_type::text end as component_type,
                (case when p_group_by_type then sum(c.source_amount) else report.source_amount end)::text as reported_amount,
                (case when p_group_by_type then sum(c.fee_amount) else report.fee_amount end)::text as service_fee,
                (case when p_group_by_type then sum(c.company_amount) else report.company_amount end)::text as company_amount,
                count(*)::text as row_count,
                count(c.company_amount)::text as known_company_count
            from private.read_payout_report_records(p_report_id) c
            group by case when p_group_by_type then c.component_type::text end
        ), selected as materialized (
            select * from totals
            order by currency collate "C",component_type collate "C" nulls first
            limit p_limit + 1 offset p_offset
        ), page as (
            select * from selected
            order by currency collate "C",component_type collate "C" nulls first limit p_limit
        )
        select jsonb_build_object(
            'rows',coalesce((select jsonb_agg(to_jsonb(page)
                order by currency collate "C",component_type collate "C" nulls first) from page),'[]'::jsonb),
            'next_offset',case when (select count(*) from selected) > p_limit then p_offset + p_limit end
        )
    );
end;
$$;
revoke all on function public.payout_report_records(uuid, integer, bigint, text[]),
public.payout_report_totals(uuid, boolean, integer, bigint)
from public, anon, authenticated, service_role;
