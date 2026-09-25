-- Raw source pages retain the public source views' RLS, including operator
-- access to historical versions and account-level categories. Unlike live
-- Transactions, these pages must not add a current-version/category predicate.
-- Choose stored date/amount candidates before projecting version metadata.
-- Keep large source JSON out of the bounded amount candidate inventory.
-- Date ordering reverses the entire date/ID key; amount ties stay ascending.
-- The unchanged fact/version RLS policies guarantee a visible parent version
-- for every visible fact (operators see all; members see owned current versions).
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
    p_marketplaces public.amazon_marketplace_name[] default null,
    p_types text[] default null,
    p_include_count boolean default true,
    p_search text default null
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
    projection text;
    candidate_projection text;
    source_predicate text;
    search_pattern text;
    result jsonb;
begin
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_dataset is null or p_dataset not in ('settlement', 'data_kiosk') then
        raise exception 'Dataset must be settlement or data_kiosk' using errcode = '22023';
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
    search_pattern := private.literal_search_pattern(p_search);
    -- SQL identifiers and fragments are chosen only from internal constants.
    -- All filter/pagination values stay parameters. No caller SQL is executed.
    if p_dataset = 'settlement' then
        fact_relation := 'settlement_transactions';
        version_relation := 'settlement_preprocess_versions';
        date_column := 'posted_date';
        identity_column := 'settlement_id';
        source_predicate := 'true';
        candidate_projection := 't.family, t.accounting_subtype, t.posted_date, t.posted_at,
            t.transaction_type, t.amount_type, t.amount_description';
        projection := 'p.family, p.accounting_subtype, p.posted_date, p.posted_at,
            p.transaction_type, p.amount_type, p.amount_description';
    else
        fact_relation := 'data_kiosk_transactions';
        version_relation := 'data_kiosk_preprocess_versions';
        date_column := 'activity_date';
        identity_column := 'day_id';
        source_predicate := 't.amount <> 0';
        candidate_projection := 't.activity_date, t.component_key, t.fee_base, t.source_document_id';
        projection := 'p.activity_date, p.component_key, p.fee_base::text,
            p.source_document_id';
    end if;
    sort_column := case p_order_by when 'amount' then 'amount' else date_column end;
    sort_direction := case p_direction when 'asc' then 'asc' else 'desc' end;
    sort_nulls := case when p_order_by = 'date' and p_direction = 'desc' then 'first' else 'last' end;
    tie_direction := case p_order_by when 'date' then sort_direction else 'asc' end;
    candidate_materialization := case p_order_by when 'amount' then 'materialized' else 'not materialized' end;
    candidate_cap := case p_order_by when 'amount' then 'limit 10001' else '' end;

    execute format($query$
        with matching as not materialized (
            select t.id, t.version_id, t.seller_namespace, t.source_line_number,
                t.category, t.component_type, t.sku, t.marketplace_name, t.amount,
                t.currency, t.quantity, t.created_at, %12$s
            from private.%1$I as t
            where %2$s
                and ($1::date is null or t.%3$I >= $1)
                and ($2::date is null or t.%3$I <= $2)
                and (coalesce(cardinality($3::text[]), 0) = 0 or t.sku = any($3))
                and (coalesce(cardinality($4::public.amazon_marketplace_name[]), 0) = 0
                    or t.marketplace_name = any($4))
                and (coalesce(cardinality($5::text[]), 0) = 0 or t.component_type = any($5))
                and private.visible_transaction_search_matches(
                    $9::text, null, t.sku, t.component_type, t.marketplace_name::text, t.currency
                )
        ),
        candidates as %10$s (
            select t.* from matching as t %11$s
        ),
        candidate_count as materialized (
            select count(*) as value from candidates
        ),
        page as materialized (
            select t.* from candidates as t
            order by t.%4$I %5$s nulls %13$s, t.id %14$s
            limit $6::integer offset $7::bigint
        ),
        result_rows as (
            select p.id, p.version_id, v.%6$I, v.preprocess_version,
                p.seller_namespace, p.source_line_number::text,
                p.category, p.component_type, p.sku, p.marketplace_name,
                p.amount::text, p.currency, p.quantity::text, p.created_at,
                %7$s
            from page as p
            join private.%8$I as v on v.id = p.version_id
        )
        -- Probe fully filtered visibility before evaluating the sorted page.
        -- The bounded candidate inventory is reused when amount count is wanted.
        select case when $10::boolean and (select value from candidate_count) > 10000
            then null::jsonb
        else jsonb_build_object(
            'rows', (
                select coalesce(jsonb_agg(to_jsonb(r)
                    order by %9$s %5$s nulls %13$s, r.id %14$s), '[]'::jsonb)
                from result_rows as r
            ),
            'total_count', case when $8::boolean then
                case when $10::boolean then (select value::text from candidate_count)
                else (select count(*)::text from matching) end
            end
        ) end
    $query$, fact_relation, source_predicate, date_column, sort_column,
        sort_direction, identity_column, projection, version_relation,
        case p_order_by when 'amount' then 'r.amount::numeric' else format('r.%I', date_column) end,
        candidate_materialization, candidate_cap, candidate_projection, sort_nulls, tie_direction)
    into result
    using p_date_from, p_date_to, p_skus, p_marketplaces, p_types,
        p_limit, p_offset, p_include_count, search_pattern, p_order_by = 'amount';
    if result is null then
        raise exception 'Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.'
            using errcode = '22023';
    end if;
    return result;
end;
$$;

revoke all on function public.source_transaction_page(
    text, integer, bigint, text, text, date, date, text[],
    public.amazon_marketplace_name[], text[], boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.source_transaction_page(
    text, integer, bigint, text, text, date, date, text[],
    public.amazon_marketplace_name[], text[], boolean, text
) to authenticated;

notify pgrst, 'reload schema';
