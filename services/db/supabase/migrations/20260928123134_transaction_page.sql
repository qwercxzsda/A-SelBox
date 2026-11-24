create function public.transaction_page(
    p_limit integer default 25,
    p_offset bigint default 0,
    p_direction text default 'desc',
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_sources text[] default null,
    p_types text[] default null,
    p_include_count boolean default true,
    p_fee_applicable boolean default null,
    p_order_by text default 'date',
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null,
    p_search_sources text[] default null,
    p_currency text default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare result jsonb; sort_field text; dir text; tie text;
begin
    perform private.validate_page_bounds(p_limit,p_offset);
    if p_direction not in ('asc','desc') or p_direction is null or p_order_by not in ('date','amount')
        or p_order_by is null or p_include_count is null then raise exception 'Invalid page options' using errcode='22023'; end if;
    sort_field:=case p_order_by when 'date' then 'activity_at' else 'source_amount' end;
    dir:=p_direction;
    tie:=case when p_order_by='date' then dir else 'asc' end;
    execute format($query$
        with facts as materialized (select * from private.filtered_components($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)),
        page as (select * from facts order by %1$I %2$s,source %3$s,source_row_id %3$s limit $14 offset $15)
        select case when $17 and (select count(*) from facts)>10000 then null else jsonb_build_object(
            'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object(
                'activity_at',to_char(activity_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                'source_amount',source_amount::text,'base_amount',base_amount::text,'tax_amount',tax_amount::text,
                'fee_base',fee_base::text,'quantity',quantity::text,'fee_amount',fee_amount::text,
                'fee_rate_percent',fee_rate_percent::text,'company_amount',company_amount::text)
                order by %1$I %2$s,source %3$s,source_row_id %3$s) from page p),'[]'),
            'total_count',case when $16 then (select count(*)::text from facts) end) end
    $query$,sort_field,dir,tie) into result using p_date_from,p_date_to,p_company_ids,p_skus,p_marketplaces,p_sources,p_types,p_fee_applicable,p_search_skus,p_search_types,p_search_marketplaces,p_search_sources,p_currency,p_limit,p_offset,p_include_count,p_order_by='amount';
    if result is null then raise exception 'Amount ordering exceeds the row limit' using errcode='22023',
        detail='{"code":"AMOUNT_ORDER_LIMIT","limit":10000}'; end if;
    return result;
end;
$$;
