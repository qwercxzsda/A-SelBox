-- Exact native-ID lookup has a dedicated index; it does not scan SKU/type search.
create index finances_component_native_lookup_idx
on private.finances_transaction_components (native_transaction_id, id);

-- Raw source pages retain the public source views' RLS, including administrator
-- access to historical versions and account-level categories. Unlike live
-- Transactions, these pages must not add a current-version/category predicate.
-- Choose stored date/amount candidates before projecting version metadata.
-- Keep large source JSON out of the bounded amount candidate inventory.
-- Date ordering reverses the entire date/ID key; amount ties stay ascending.
-- The unchanged fact/version RLS policies guarantee a visible parent version
-- for every visible fact (administrators see all versions; members see all current references).
-- This allows pagination and counts to omit the metadata join; the final join
-- remains SECURITY INVOKER. Recheck that implication if those policies change.
create function public.source_transaction_page(
    p_dataset text,
    p_limit integer default 25,
    p_offset bigint default 0,
    p_order_by text default 'date',
    p_direction text default 'desc',
    p_date_from date default null,
    p_date_to date default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_types text[] default null,
    p_include_count boolean default true,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    fact_relation text;
    version_relation text;
    date_column text;
    identity_column text;
    sort_column text;
    sort_direction text;
    sort_nulls text;
    tie_direction text;
    candidate_materialization text;
    candidate_cap text;
    candidate_query text;
    marketplace_candidate_budget constant bigint := 4096;
    projection text;
    candidate_projection text;
    result jsonb;
begin
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_dataset is null or p_dataset not in ('finances', 'data_kiosk') then
        raise exception 'Dataset must be finances or data_kiosk' using errcode = '22023';
    end if;
    if p_order_by is null or p_order_by not in ('date', 'amount') then
        raise exception 'Order must be date or amount' using errcode = '22023';
    end if;
    if p_direction is null or p_direction not in ('asc', 'desc') then
        raise exception 'Sort direction must be asc or desc' using errcode = '22023';
    end if;
    if p_include_count is null then
        raise exception 'Count preference is required' using errcode = '22023';
    end if;
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, null, p_skus, p_marketplaces, null, p_types
    );
    -- Search is resolved to exact catalog values by the client. Unlike normal
    -- selection filters, supplied empty search arrays intentionally match nothing.
    perform private.validate_transaction_filters(
        null, null, null, p_search_skus, p_search_marketplaces,
        null, p_search_types
    );
    -- SQL identifiers and fragments are chosen only from internal constants.
    -- All filter/pagination values stay parameters. No caller SQL is executed.
    if p_dataset = 'finances' then
        fact_relation := 'finances_transaction_components';
        version_relation := 'finances_preprocess_versions';
        date_column := 'posted_date';
        identity_column := 'day_id';
        candidate_projection := 't.transaction_id,t.native_transaction_id,t.deferred_transaction_id,t.release_transaction_id,
            t.source_page_number,t.source_record_number,t.accounting_subtype,t.posted_date,t.posted_at,t.component_key,t.fee_base,
            t.transaction_type,t.transaction_status,t.account_type,t.activity_eligible,t.breakdown_path';
        projection := 'p.transaction_id,p.native_transaction_id,p.deferred_transaction_id,p.release_transaction_id,
            p.source_page_number::text,p.source_record_number::text,p.accounting_subtype,p.posted_date,p.posted_at,p.component_key,p.fee_base::text,
            p.transaction_type,p.transaction_status,p.account_type,p.activity_eligible::text,p.breakdown_path::text';
    else
        fact_relation := 'data_kiosk_transactions';
        version_relation := 'data_kiosk_preprocess_versions';
        date_column := 'activity_date';
        identity_column := 'day_id';
        candidate_projection := 't.source_line_number,t.activity_date, t.component_key, t.fee_base, t.source_document_id';
        projection := 'p.source_line_number::text,p.activity_date, p.component_key, p.fee_base::text,
            p.source_document_id';
    end if;
    sort_column := case p_order_by when 'amount' then 'amount' else date_column end;
    sort_direction := case p_direction when 'asc' then 'asc' else 'desc' end;
    sort_nulls := case when p_order_by = 'date' and p_direction = 'desc' then 'first' else 'last' end;
    tie_direction := case p_order_by when 'date' then sort_direction else 'asc' end;
    candidate_materialization := case p_order_by when 'amount' then 'materialized' else 'not materialized' end;
    candidate_cap := case p_order_by when 'amount' then 'limit 10001' else '' end;

    -- Keep matching unbounded: exact date counts read it independently.
    -- Only date candidates are bounded per distinct marketplace and merged.
    candidate_query := 'select t.* from matching as t ' || candidate_cap;
    -- This is a candidate-work heuristic, never a result limit or rejection.
    -- Divide to avoid overflow for large offsets or repeated filter values.
    if p_order_by = 'date' and cardinality(p_marketplaces) > 1
        and p_offset + p_limit <= marketplace_candidate_budget / nullif(cardinality(p_marketplaces), 0) then
        candidate_query := format($markets$
            select market_page.*
            from (select distinct marketplace_name
                  from unnest($4::text[]) as requested_marketplaces(marketplace_name)) selected_marketplaces
            cross join lateral (
                select t.* from matching as t
                where t.marketplace_name = selected_marketplaces.marketplace_name
                order by t.%I %s nulls %s, t.id %s
                limit ($6::bigint + $7::bigint)
            ) as market_page
            order by market_page.%I %s nulls %s, market_page.id %s
            limit ($6::bigint + $7::bigint)
        $markets$, date_column, sort_direction, sort_nulls, tie_direction,
            date_column, sort_direction, sort_nulls, tie_direction);
    end if;

    execute format($query$
        with matching as not materialized (
            select t.id, t.version_id, t.seller_namespace,
                t.category, t.component_type, t.sku, t.marketplace_name, t.amount,
                t.currency, t.quantity, t.created_at, %11$s
            from private.%1$I as t
            where ($1::date is null or t.%2$I >= $1)
                and ($2::date is null or t.%2$I <= $2)
                and (coalesce(cardinality($3::text[]), 0) = 0 or t.sku = any($3))
                and case when cardinality($4::text[]) = 1
                    then t.marketplace_name = ($4::text[])[array_lower($4::text[], 1)]
                    else coalesce(cardinality($4::text[]), 0) = 0
                        or t.marketplace_name = any($4)
                end
                and (coalesce(cardinality($5::text[]), 0) = 0 or t.component_type = any($5))
                and (
                    ($9::text[] is null and $10::text[] is null and $11::text[] is null)
                    or t.sku = any($9) or t.component_type = any($10)
                    or t.marketplace_name = any($11)
                )
        ),
        candidates as %9$s (
            %10$s
        ),
        candidate_count as materialized (
            select count(*) as value from candidates
        ),
        page as materialized (
            select t.* from candidates as t
            order by t.%3$I %4$s nulls %12$s, t.id %13$s
            limit $6::integer offset $7::bigint
        ),
        result_rows as (
            select p.id, p.version_id, v.%5$I, v.preprocess_version,
                p.seller_namespace,
                p.category, p.component_type, p.sku, p.marketplace_name,
                p.amount::text, p.currency, p.quantity::text, p.created_at,
                %6$s
            from page as p
            join private.%7$I as v on v.id = p.version_id
        )
        -- Probe fully filtered visibility before evaluating the sorted page.
        -- The bounded candidate inventory is reused when amount count is wanted.
        select case when $12::boolean and (select value from candidate_count) > 10000
            then null::jsonb
        else jsonb_build_object(
            'rows', (
                select coalesce(jsonb_agg(to_jsonb(r)
                    order by %8$s %4$s nulls %12$s, r.id %13$s), '[]'::jsonb)
                from result_rows as r
            ),
            'total_count', case when $8::boolean then
                case when $12::boolean then (select value::text from candidate_count)
                else (select count(*)::text from matching) end
            end
        ) end
    $query$, fact_relation, date_column, sort_column,
        sort_direction, identity_column, projection, version_relation,
        case p_order_by when 'amount' then 'r.amount::numeric' else format('r.%I', date_column) end,
        candidate_materialization, candidate_query, candidate_projection, sort_nulls, tie_direction)
    into result
    using p_date_from, p_date_to, p_skus, p_marketplaces, p_types,
        p_limit, p_offset, p_include_count, p_search_skus, p_search_types, p_search_marketplaces,
        p_order_by = 'amount';
    if result is null then
        raise exception 'Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.'
            using errcode = '22023';
    end if;
    return result;
end;
$$;

revoke all on function public.source_transaction_page(
    text, integer, bigint, text, text, date, date, text[],
    text[], text[], boolean, text[], text[], text[]
) from public, anon, authenticated, service_role;

-- Detail links are exact row/version identities, including retained observations.
-- Convert every scalar to text inside PostgreSQL before JSON reaches JavaScript.
create function public.financial_source_record(
    p_source text, p_row_id uuid, p_version_id uuid
) returns jsonb
language plpgsql stable security invoker
set search_path = '' as $$
declare
    source_record jsonb;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access is required' using errcode = '42501';
    end if;
    if p_source is null or p_source not in ('FINANCES', 'DATA_KIOSK')
        or p_row_id is null or p_version_id is null then
        raise exception 'A valid source row and version are required' using errcode = '22023';
    end if;
    if p_source = 'FINANCES' then
        select to_jsonb(t) into source_record
        from public.finances_preprocess_entries t
        where t.id = p_row_id and t.version_id = p_version_id;
    else
        select to_jsonb(t) into source_record
        from public.data_kiosk_preprocess_entries t
        where t.id = p_row_id and t.version_id = p_version_id;
    end if;
    return (select jsonb_object_agg(key, value) from jsonb_each_text(source_record));
end;
$$;

-- Exact ID search covers all retained captures and labels their current status.
-- Never add observations together: multiple components and captures are distinct.
create function public.financial_source_transaction_lookup(
    p_native_transaction_id text, p_limit integer default 25, p_offset bigint default 0
) returns jsonb
language plpgsql stable security invoker
set search_path = '' as $$
declare
    result jsonb;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access is required' using errcode = '42501';
    end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_limit > 100 or p_native_transaction_id is null
        or length(btrim(p_native_transaction_id)) = 0
        or length(p_native_transaction_id) > 512 then
        raise exception 'A valid exact Amazon transaction ID is required' using errcode = '22023';
    end if;
    with records as materialized (
        select t.*, case when d.current_version_id = t.version_id
            then 'Current' else 'Retained' end as capture_status
        from public.finances_preprocess_entries t
        join private.finances_days d on d.id = t.day_id
        where t.native_transaction_id = p_native_transaction_id
        order by t.id
        limit p_limit offset p_offset
    )
    select coalesce(jsonb_agg(
        (select jsonb_object_agg(key, value) from jsonb_each_text(to_jsonb(r)))
        order by r.id
    ), '[]'::jsonb) into result from records r;
    return result;
end;
$$;
revoke all on function public.financial_source_record(text, uuid, uuid),
public.financial_source_transaction_lookup(text, integer, bigint)
from public, anon, authenticated, service_role;
