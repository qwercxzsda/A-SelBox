-- Aggregate the caller's permitted company rows within the requested UTC dates.
-- Exact numeric sums retain the distinction between missing fees and zero.
create function private.read_transaction_totals(
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
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
    result jsonb;
    companies uuid[] := private.transaction_company_scope(p_company_ids);
begin
    perform private.validate_live_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces, p_sources,
        p_types, p_search_skus, p_search_types, p_search_marketplaces, p_search_sources, p_currency, true
    );
    if p_group_by_type is null then
        raise exception 'Grouping preference is required' using errcode = '22023';
    end if;
    if p_granularity is not null and p_granularity not in ('day', 'week') then
        raise exception 'Trend granularity must be day or week' using errcode = '22023';
    end if;
    if cardinality(companies)=0 then
        return jsonb_build_object('rows','[]'::jsonb,'group_count','0');
    end if;
    result:=(
        with totals as (
            select case when not p_group_by_type or p_granularity is not null then c.marketplace_name end as marketplace_name,
                c.currency,case when p_group_by_type or p_granularity is not null then c.component_type end as component_type,
                date_trunc(p_granularity,c.activity_at at time zone 'UTC')::date as period_start,
                sum(c.source_amount) as reported_amount,sum(c.fee_amount) as service_fee,sum(c.company_amount) as company_amount,
                count(*) as row_count,count(c.company_amount) as known_company_count
            from private.filtered_components(
                p_date_from, p_date_to, companies, p_skus, p_marketplaces, p_sources, p_types,
                p_fee_applicable, p_search_skus, p_search_types, p_search_marketplaces,
                p_search_sources, p_currency
            ) c group by 1,2,3,4
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
language sql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
    select private.read_transaction_totals(
        p_date_from, p_date_to, p_company_ids, p_skus,
        p_marketplaces, p_currency, p_group_by_type, p_sources,
        p_types, p_fee_applicable, p_search_skus, p_search_types,
        p_search_marketplaces, p_search_sources, p_granularity
    );
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
declare
    report public.company_payout_reports;
    from_day date;
    exact_count integer;
    result jsonb;
begin
    if p_report_id is null then
        raise exception 'Report and record scope are required' using errcode='22023';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    perform private.validate_transaction_filters(null,null,null,null,null,null,p_types);
    select * into report from public.company_payout_reports where id = p_report_id;
    if not found then raise exception 'Report access required' using errcode = '42501'; end if;
    if coalesce(cardinality(p_types), 0) = 0 then
        exact_count := report.record_count;
        if p_offset >= exact_count then
            return jsonb_build_object('rows', '[]'::jsonb, 'total_count', exact_count::text);
        end if;
        -- Dense unfiltered reports commonly fill a complete page on their last day.
        if (report.end_date - report.start_date + 1)::bigint * (p_offset + p_limit) <= exact_count then
            from_day := report.end_date;
        end if;
    end if;
    loop
        with records as materialized (
            select * from private.read_payout_report_records(p_report_id, from_day, p_types)
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
            'total_count',coalesce(exact_count::text, (select count(*)::text from records)))
        into result;
        exit when from_day is null or jsonb_array_length(result->'rows') = p_limit;
        from_day := null;
    end loop;
    return result;
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
    if not p_group_by_type then
        return jsonb_build_object(
            'rows',case when report.record_count = 0 or p_offset > 0 then '[]'::jsonb else
                jsonb_build_array(jsonb_build_object('currency',report.currency,'component_type',null,
                    'reported_amount',report.source_amount::text,'service_fee',report.fee_amount::text,
                    'company_amount',report.company_amount::text,'row_count',report.record_count::text,
                    'known_company_count',report.record_count::text)) end,
            'next_offset',null
        );
    end if;
    return (
        with totals as (
            select report.currency,
                c.component_type::text as component_type,
                sum(c.source_amount)::text as reported_amount,
                sum(c.fee_amount)::text as service_fee,
                sum(c.company_amount)::text as company_amount,
                count(*)::text as row_count,
                count(c.company_amount)::text as known_company_count
            from private.read_payout_report_records(p_report_id) c
            group by c.component_type::text
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
