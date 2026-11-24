create function private.read_transaction_page(
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
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    result jsonb;
    page_query text;
    edge date;
    from_day date := p_date_from;
    to_day date := p_date_to;
    sort_field text;
    tie_direction text;
    candidates text;
    companies uuid[] := private.transaction_company_scope(p_company_ids);
begin
    perform private.validate_page_bounds(p_limit,p_offset);
    if p_direction not in ('asc','desc') or p_direction is null or p_order_by not in ('date','amount')
        or p_order_by is null or p_include_count is null then raise exception 'Invalid page options' using errcode='22023'; end if;
    perform private.validate_live_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces, p_sources,
        p_types, p_search_skus, p_search_types, p_search_marketplaces, p_search_sources, p_currency, false
    );
    if cardinality(companies)=0 then
        return jsonb_build_object('rows','[]'::jsonb,'total_count',case when p_include_count then '0' end);
    end if;
    -- Date pages and their exact counts get independent plans. Amount ordering
    -- shares at most 10,001 candidates for its bounded sort and overflow check.
    candidates:=case p_order_by when 'amount' then 'materialized' else 'not materialized' end;
    sort_field:=case p_order_by when 'date' then 'activity_at' else 'source_amount' end;
    tie_direction:=case when p_order_by='date' then p_direction else 'asc' end;
    page_query:=format($query$
        with facts as %4$s (
            select * from private.filtered_components($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            %5$s
        ),
        page as (select * from facts order by %1$I %2$s,source %3$s,source_row_id %3$s limit $14 offset $15)
        select case when $17 and (select count(*) from facts)>10000 then null else jsonb_build_object(
            'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object(
                'activity_at',to_char(activity_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                'source_amount',source_amount::text,'base_amount',base_amount::text,'tax_amount',tax_amount::text,
                'fee_base',fee_base::text,'quantity',quantity::text,'fee_amount',fee_amount::text,
                'fee_rate_percent',fee_rate_percent::text,'company_amount',company_amount::text)
                order by %1$I %2$s,source %3$s,source_row_id %3$s) from page p),'[]'),
            'total_count',case when $16 then (select count(*)::text from facts) end) end
    $query$,sort_field,p_direction,tie_direction,candidates,case when p_order_by='amount' then 'limit 10001' else '' end);

    -- Every output row is dated by a Finances charge, including the earliest
    -- matching charge used by invoice and warehouse rows. Seek the requested
    -- edge in the time index, then resolve a small range of complete UTC days.
    -- A sparse filter or member can exhaust that range. In that case retry the
    -- original range before returning any rows.
    if p_order_by='date' and not p_include_count and p_offset<10000 then
        execute format($edge$
            select (h.posted_at at time zone 'UTC')::date from private.finances_transactions h
            where h.is_activity
                and ($1 is null or h.posted_at >= $1::timestamp at time zone 'UTC')
                and ($2 is null or h.posted_at < ($2+1)::timestamp at time zone 'UTC')
                and ($3 is null or h.currency=$3)
                and (coalesce(cardinality($4),0)=0 or h.marketplace_name=any($4))
            order by h.posted_at %s limit 1 offset $5
        $edge$,p_direction) into edge using p_date_from,p_date_to,p_currency,p_marketplaces,
            greatest(p_limit+p_offset,64);
        if p_direction='desc' then
            from_day:=greatest(p_date_from,edge);
        else
            to_day:=least(p_date_to,edge);
        end if;
    end if;
    loop
        execute page_query into result using from_day,to_day,companies,p_skus,p_marketplaces,
            p_sources,p_types,p_fee_applicable,p_search_skus,p_search_types,p_search_marketplaces,
            p_search_sources,p_currency,p_limit,p_offset,p_include_count,p_order_by='amount';
        exit when (from_day is not distinct from p_date_from and to_day is not distinct from p_date_to)
            or jsonb_array_length(result->'rows')=p_limit;
        from_day:=p_date_from;
        to_day:=p_date_to;
    end loop;
    if result is null then raise exception 'Amount ordering exceeds the row limit' using errcode='22023',
        detail='{"code":"AMOUNT_ORDER_LIMIT","limit":10000}'; end if;
    return result;
end;
$$;
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
language sql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
    select private.read_transaction_page(
        p_limit, p_offset, p_direction, p_date_from,
        p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_sources, p_types, p_include_count, p_fee_applicable,
        p_order_by, p_search_skus, p_search_types, p_search_marketplaces,
        p_search_sources, p_currency
    );
$$;
