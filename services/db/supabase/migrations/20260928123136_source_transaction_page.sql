-- Bounded source reads project metadata only after selecting the requested component page.
create function public.source_transaction_page(
    p_dataset text, p_limit integer default 25, p_offset bigint default 0,
    p_order_by text default 'date', p_direction text default 'desc',
    p_date_from date default null, p_date_to date default null,
    p_skus text[] default null, p_marketplaces text[] default null,
    p_types text[] default null, p_include_count boolean default true,
    p_search_skus text[] default null, p_search_types text[] default null,
    p_search_marketplaces text[] default null
) returns jsonb language plpgsql stable security invoker
set search_path = '' set plan_cache_mode = 'force_custom_plan' as $$
declare fact_relation text; entry_relation text; date_column text;
    sort_column text; sort_direction text; tie_direction text; sort_nulls text;
    candidate_cap text; candidate_materialization text; result jsonb;
begin
    perform private.validate_page_bounds(p_limit,p_offset);
    if p_dataset is null or p_dataset not in ('finances','data_kiosk') then
        raise exception 'Dataset must be finances or data_kiosk' using errcode='22023'; end if;
    if p_order_by is null or p_order_by not in ('date','amount')
        or p_direction is null or p_direction not in ('asc','desc')
        or p_include_count is null then
        raise exception 'Valid ordering and count preference required' using errcode='22023'; end if;
    perform private.validate_transaction_filters(p_date_from,p_date_to,null,p_skus,p_marketplaces,null,p_types);
    perform private.validate_transaction_filters(null,null,null,p_search_skus,p_search_marketplaces,null,p_search_types);
    fact_relation:=case p_dataset when 'finances' then 'finances_component_details' else 'data_kiosk_transactions' end;
    entry_relation:=case p_dataset when 'finances' then 'finances_preprocess_entries' else 'data_kiosk_preprocess_entries' end;
    date_column:=case p_dataset when 'finances' then 'posted_date' else 'activity_date' end;
    sort_column:=case p_order_by when 'amount' then 'amount' else date_column end;
    sort_direction:=case p_direction when 'asc' then 'asc' else 'desc' end;
    tie_direction:=case p_order_by when 'date' then sort_direction else 'asc' end;
    sort_nulls:=case when p_order_by='date' and p_direction='desc' then 'first' else 'last' end;
    candidate_cap:=case p_order_by when 'amount' then 'limit 10001' else '' end;
    candidate_materialization:=case p_order_by when 'amount' then 'materialized' else 'not materialized' end;
    execute format($query$
      with matching as not materialized (
        select t.id,t.%3$I as sort_value from private.%1$I t
        where ($1::date is null or t.%2$I >= $1) and ($2::date is null or t.%2$I <= $2)
          and (coalesce(cardinality($3::text[]),0)=0 or t.sku=any($3))
          and (coalesce(cardinality($4::text[]),0)=0 or t.marketplace_name=any($4))
          and (coalesce(cardinality($5::text[]),0)=0 or t.component_type=any($5))
          and (($9::text[] is null and $10::text[] is null and $11::text[] is null)
            or t.sku=any($9) or t.component_type=any($10) or t.marketplace_name=any($11))
      ), candidates as %9$s (select * from matching %8$s),
      page as materialized (
        select * from candidates order by sort_value %4$s nulls %6$s,id %5$s limit $6 offset $7
      ), result_rows as (
        select p.sort_value,p.id,
          (select jsonb_object_agg(key,value) from jsonb_each_text(to_jsonb(e) - 'native_dimensions')) as payload
        from page p join public.%7$I e on e.id=p.id
      )
      select case when $12 and (select count(*) from candidates)>10000 then null::jsonb
        else jsonb_build_object(
          'rows',(select coalesce(jsonb_agg(payload order by sort_value %4$s nulls %6$s,id %5$s),'[]'::jsonb) from result_rows),
          'total_count',case when $8 then (select count(*)::text from matching) end)
        end
    $query$,fact_relation,date_column,sort_column,sort_direction,tie_direction,sort_nulls,entry_relation,candidate_cap,candidate_materialization)
    into result using p_date_from,p_date_to,p_skus,p_marketplaces,p_types,p_limit,p_offset,
        p_include_count,p_search_skus,p_search_types,p_search_marketplaces,p_order_by='amount';
    if result is null then raise exception 'Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.' using errcode='22023'; end if;
    return result;
end;
$$;
revoke all on function public.source_transaction_page(
    text,
    integer,
    bigint,
    text,
    text,
    date,
    date,
    text[],
    text[],
    text[],
    boolean,
    text[],
    text[],
    text[]
) from public,
anon,
authenticated,
service_role;

-- Exact immutable source references are independent of the current selection.
create function public.financial_source_record(p_source text, p_row_id uuid, p_version_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare source_record jsonb;
begin
    if not private.is_administrator() then raise exception 'Administrator access is required' using errcode='42501'; end if;
    if p_source is null or p_source not in ('FINANCES','DATA_KIOSK') or p_row_id is null or p_version_id is null then
        raise exception 'A valid source row and revision are required' using errcode='22023'; end if;
    if p_source='FINANCES' then
        select to_jsonb(t) into source_record from public.finances_preprocess_entries t
        where t.id=p_row_id and t.version_id=p_version_id;
    else
        select to_jsonb(t) into source_record from public.data_kiosk_preprocess_entries t
        where t.id=p_row_id and t.version_id=p_version_id;
    end if;
    return (select jsonb_object_agg(key,value) from jsonb_each_text(source_record));
end;
$$;
create function public.financial_source_transaction_lookup(
    p_native_transaction_id text, p_limit integer default 25, p_offset bigint default 0
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
    if not private.is_administrator() then raise exception 'Administrator access is required' using errcode='42501'; end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    if p_limit>100 or p_native_transaction_id is null or length(btrim(p_native_transaction_id))=0 or length(p_native_transaction_id)>512 then
        raise exception 'A valid exact Amazon transaction ID is required' using errcode='22023'; end if;
    with records as materialized (
        select t.*,case when t.is_current then 'Current' else 'Retained' end as capture_status
        from public.finances_preprocess_entries t where t.native_transaction_id=p_native_transaction_id
        order by t.id limit p_limit offset p_offset
    ) select coalesce(jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each_text(to_jsonb(r))) order by r.id),'[]'::jsonb)
      into result from records r;
    return result;
end;
$$;
revoke all on function public.financial_source_record(text, uuid, uuid),
public.financial_source_transaction_lookup(text, integer, bigint) from public,
anon,
authenticated,
service_role;
