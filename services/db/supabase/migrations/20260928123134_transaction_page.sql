-- Select eligible facts per source before metadata, ownership projection,
-- and fee calculation. Keeping offset + limit rows from each ordered source is
-- sufficient for date pages, including deterministic source/ID ties. Amount
-- ordering is limited to 10,000 fully filtered rows and needs no amount indexes.
-- Date direction reverses the complete date/source/ID order, matching a single
-- source date/ID index in either scan direction. Amount ties remain ascending.
-- SECURITY INVOKER preserves fact, metadata, ownership, and fee RLS throughout.
-- Only authenticated non-operators with active fact RLS omit the duplicate
-- current-pointer EXISTS: their unchanged fact policies already require it.
-- Operators, owners, bypass contexts, and disabled RLS keep the explicit check.
-- Revalidate this optimization whenever the authenticated fact policies change.
-- The count helper remains a full matching-row count; it is intentionally not
-- replaced with the number of limited candidates. Both execute in one snapshot.
-- Applicability filters use source-specific Type codes and existing Type/date
-- indexes; the page's fee bases and rate calculations retain their source rules.
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
    p_search_sources text[] default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    sort_direction text;
    sort_column text;
    sort_nulls text;
    tie_direction text;
    source_order text;
    marketplace_candidate_budget constant bigint := 4096;
    marketplace_prefix text := '';
    marketplace_suffix text := '';
    marketplace_predicate text;
    candidate_materialization text;
    candidate_cap text;
    candidate_limit bigint;
    result jsonb;
begin
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_direction is null or p_direction not in ('asc', 'desc') then
        raise exception 'Sort direction must be asc or desc' using errcode = '22023';
    end if;
    if p_order_by is null or p_order_by not in ('date', 'amount') then
        raise exception 'Order must be date or amount' using errcode = '22023';
    end if;
    if p_include_count is null then
        raise exception 'Count preference is required' using errcode = '22023';
    end if;
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_sources, p_types
    );
    -- Search is resolved to exact catalog values by the client. Unlike normal
    -- selection filters, supplied empty search arrays intentionally match nothing.
    perform private.validate_transaction_filters(
        null, null, null, p_search_skus, p_search_marketplaces,
        p_search_sources, p_search_types
    );
    -- Interpolate only these internal constants, never caller-supplied SQL.
    -- EXECUTE exposes the chosen native ordering to the planner; filter values
    -- and pagination stay bound parameters. There is one maintained query body.
    sort_direction := case p_direction when 'asc' then 'asc' else 'desc' end;
    sort_column := case p_order_by when 'amount' then 'source_amount' else 'activity_date' end;
    sort_nulls := case when p_order_by = 'date' and p_direction = 'desc' then 'first' else 'last' end;
    tie_direction := case p_order_by when 'date' then sort_direction else 'asc' end;
    if p_order_by = 'amount' then
        -- Probe eligibility without sorting, stopping at the first excess row.
        candidate_limit := 10001;
        source_order := '';
        candidate_materialization := 'materialized';
        candidate_cap := 'limit 10001';
    else
        candidate_limit := p_offset + p_limit;
        source_order := format('order by activity_date %s nulls %s, source %s, source_row_id %s',
            sort_direction, sort_nulls, tie_direction, tie_direction);
        candidate_materialization := 'not materialized';
        candidate_cap := '';
    end if;

    -- Bound each selected market before merging a date-ordered source page.
    -- Only fixed SQL fragments are interpolated; selected values remain bound.
    marketplace_predicate := $market$case when cardinality($5::text[]) = 1
        then t.marketplace_name = ($5::text[])[array_lower($5::text[], 1)]
        else coalesce(cardinality($5::text[]), 0) = 0
            or t.marketplace_name = any($5)
        end$market$;
    -- This is a candidate-work heuristic, never a result limit or rejection.
    -- Divide to avoid overflow for large offsets or repeated filter values.
    if p_order_by = 'date' and cardinality(p_marketplaces) > 1
        and p_offset + p_limit <= marketplace_candidate_budget / nullif(cardinality(p_marketplaces), 0) then
        marketplace_prefix := $market$select market_page.*
        from (select distinct marketplace_name
              from unnest($5::text[]) as requested_marketplaces(marketplace_name)) selected_marketplaces
        cross join lateral ($market$;
        marketplace_predicate := 't.marketplace_name = selected_marketplaces.marketplace_name';
        marketplace_suffix := ') as market_page ' || source_order || ' limit $8::bigint';
    end if;

    execute format($query$
        with candidates as %4$s (
            (
                %8$s
                select
                    'SETTLEMENT'::text as source,
                    t.id as source_row_id,
                    t.version_id as source_version_id,
                    t.seller_namespace,
                    t.marketplace_name,
                    t.posted_date as activity_date,
                    t.sku,
                    t.component_type,
                    t.currency,
                    t.amount as source_amount,
                    t.quantity::numeric as quantity,
                    case
                        when t.category = 'SETTLEMENT' and private.settlement_fee_applicable(
                            t.transaction_type, t.amount_type, t.amount_description
                        ) then t.amount
                    end as fee_base,
                    t.category
                from private.settlement_transactions as t
                where t.category in ('SETTLEMENT', 'SELBOX')
                    and t.posted_date < (select private.mature_cutoff_date())
                    and (
                        (select private.member_policy_covers_current_version(
                            'private.settlement_transactions'::regclass
                        ))
                        or exists (
                            select 1 from private.settlements as h
                            where h.current_version_id = t.version_id
                        )
                    )
                    and ($1::date is null or t.posted_date >= $1)
                    and ($2::date is null or t.posted_date <= $2)
                    and (
                        coalesce(cardinality($3::uuid[]), 0) = 0
                        or exists (
                            select 1 from public.company_skus as o
                            where t.category <> 'SELBOX' and o.seller_namespace = t.seller_namespace
                                and o.sku = t.sku and o.company_id = any($3)
                        )
                    )
                    and (coalesce(cardinality($4::text[]), 0) = 0
                        or (t.category <> 'SELBOX' and t.sku = any($4)))
                    and %9$s
                    and (coalesce(cardinality($6::text[]), 0) = 0
                        or 'SETTLEMENT'::text = any($6))
                    and (coalesce(cardinality($7::text[]), 0) = 0
                        or t.component_type = any($7))
                    and (
                        $12::boolean is null
                        or (t.category = 'SETTLEMENT' and t.component_type in ('PRODUCT_SALES', 'PRODUCT_REFUNDS')) = $12
                    )
                    and (
                        ($13::text[] is null and $14::text[] is null
                            and $15::text[] is null and $16::text[] is null)
                        or t.sku = any($13) or t.component_type = any($14)
                        or t.marketplace_name = any($15) or 'SETTLEMENT'::text = any($16)
                    )
                %3$s
                limit $8::bigint
                %10$s
            )
            union all
            (
                %8$s
                select
                    'DATA_KIOSK'::text as source,
                    t.id as source_row_id,
                    t.version_id as source_version_id,
                    t.seller_namespace,
                    t.marketplace_name,
                    t.activity_date,
                    t.sku,
                    t.component_type,
                    t.currency,
                    t.amount as source_amount,
                    t.quantity::numeric as quantity,
                    t.fee_base,
                    t.category
                from private.data_kiosk_transactions as t
                where t.amount <> 0
                    and (t.category = 'DATA_KIOSK' or (t.activity_date >= (select private.mature_cutoff_date())
                        and t.category in ('SETTLEMENT', 'SELBOX')))
                    and (
                        (select private.member_policy_covers_current_version(
                            'private.data_kiosk_transactions'::regclass
                        ))
                        or exists (
                            select 1 from private.data_kiosk_days as h
                            where h.current_version_id = t.version_id
                        )
                    )
                    and ($1::date is null or t.activity_date >= $1)
                    and ($2::date is null or t.activity_date <= $2)
                    and (
                        coalesce(cardinality($3::uuid[]), 0) = 0
                        or exists (
                            select 1 from public.company_skus as o
                            where t.category <> 'SELBOX' and o.seller_namespace = t.seller_namespace
                                and o.sku = t.sku and o.company_id = any($3)
                        )
                    )
                    and (coalesce(cardinality($4::text[]), 0) = 0
                        or (t.category <> 'SELBOX' and t.sku = any($4)))
                    and %9$s
                    and (coalesce(cardinality($6::text[]), 0) = 0
                        or 'DATA_KIOSK'::text = any($6))
                    and (coalesce(cardinality($7::text[]), 0) = 0
                        or t.component_type = any($7))
                    and ($12::boolean is null or (t.component_type = 'NET_PRODUCT_SALES') = $12)
                    and (
                        ($13::text[] is null and $14::text[] is null
                            and $15::text[] is null and $16::text[] is null)
                        or t.sku = any($13) or t.component_type = any($14)
                        or t.marketplace_name = any($15) or 'DATA_KIOSK'::text = any($16)
                    )
                %3$s
                limit $8::bigint
                %10$s
            )
            union all
            (
                %8$s
                select 'RECONCILIATION'::text as source,
                    private.reconciliation_group_id(t.seller_namespace, t.activity_date, t.marketplace_name, t.currency) as source_row_id,
                    private.reconciliation_group_id(t.seller_namespace, t.activity_date, t.marketplace_name, t.currency) as source_version_id,
                    t.seller_namespace, t.marketplace_name, t.activity_date,
                    null::text as sku, 'SETTLEMENT_KIOSK_DIFFERENCE'::text as component_type,
                    t.currency, t.difference as source_amount, null::numeric as quantity,
                    null::numeric as fee_base, 'SELBOX'::public.allocation_category as category
                from private.live_source_reconciliation t
                where (t.data_kiosk_settlement_control <> 0 or t.data_kiosk_category_amount <> 0)
                    and ($1::date is null or t.activity_date >= $1)
                    and ($2::date is null or t.activity_date <= $2)
                    and coalesce(cardinality($3::uuid[]),0) = 0
                    and coalesce(cardinality($4::text[]),0) = 0
                    and %9$s
                    and (coalesce(cardinality($6::text[]),0) = 0 or 'RECONCILIATION' = any($6))
                    and (coalesce(cardinality($7::text[]),0) = 0
                        or 'SETTLEMENT_KIOSK_DIFFERENCE' = any($7))
                    and ($12::boolean is null or not $12)
                    and (($13::text[] is null and $14::text[] is null
                            and $15::text[] is null and $16::text[] is null)
                        or 'SETTLEMENT_KIOSK_DIFFERENCE' = any($14)
                        or t.marketplace_name = any($15) or 'RECONCILIATION' = any($16))
                %3$s
                limit $8::bigint
                %10$s
            )
            %5$s
        ),
        candidate_count as materialized (
            select count(*) as value from candidates
        ),
        raw_page as materialized (
            select c.* from candidates as c
            order by c.%2$I %1$s nulls %6$s, c.source %7$s, c.source_row_id %7$s
            limit $9::integer offset $10::bigint
        ),
        selected_terms as materialized (
            select seller_sku_id, seller_namespace, sku, terms_version_id, company_id
            from private.current_sku_terms as terms
            where exists (
                select 1 from raw_page as selected
                where selected.seller_namespace = terms.seller_namespace and selected.sku = terms.sku
                    and selected.category <> 'SELBOX'
            )
        ),
        page as materialized (
            select r.*,
                case when r.source = 'RECONCILIATION' then 'reconciliation-v1'
                    else coalesce(s.preprocess_version, k.preprocess_version) end as preprocess_version,
                case when r.source = 'RECONCILIATION' then r.source_row_id
                    else coalesce(s.settlement_id, k.day_id) end as source_identity_id,
                o.seller_sku_id, o.terms_version_id, o.company_id
            from raw_page as r
            left join private.settlement_preprocess_versions as s
                on r.source = 'SETTLEMENT' and s.id = r.source_version_id
            left join private.data_kiosk_preprocess_versions as k
                on r.source = 'DATA_KIOSK' and k.id = r.source_version_id
            left join selected_terms as o
                on r.seller_namespace = o.seller_namespace and r.sku = o.sku and r.category <> 'SELBOX'
            where s.id is not null or k.id is not null or r.source = 'RECONCILIATION'
        ),
        resolved as (
            select c.*, p.id as fee_period_id, p.fee_rate_percent,
                case
                    when c.category = 'SELBOX' then 'NOT_APPLICABLE'
                    when c.company_id is null then 'MISSING_OWNERSHIP'
                    when c.fee_base is null then 'NOT_APPLICABLE'
                    when p.id is null then 'MISSING_FEE'
                    else 'APPLIED'
                end as resolution_status
            from page as c
            left join public.sku_fee_periods as p
                on c.terms_version_id = p.terms_version_id
                    and c.marketplace_name = p.marketplace_name
                    and p.valid_period @> c.activity_date
                    and c.fee_base is not null and c.company_id is not null
        ),
        calculated as (
            select r.*,
                case
                    when r.resolution_status = 'NOT_APPLICABLE' then 0::numeric
                    when r.resolution_status = 'APPLIED'
                        then private.calculate_service_fee(r.fee_base, r.fee_rate_percent)
                end as fee_amount
            from resolved as r
        ),
        result_rows as (
            select c.source, c.source_row_id::uuid, c.source_version_id::uuid,
                c.preprocess_version::text, c.source_identity_id::uuid,
                c.seller_namespace::text, c.marketplace_name, c.activity_date,
                c.sku::text, c.component_type::text, c.currency,
                c.source_amount::numeric, c.quantity::numeric, c.fee_base::numeric,
                c.category, c.seller_sku_id::uuid, c.terms_version_id::uuid,
                c.company_id::uuid, c.fee_period_id::uuid, c.fee_rate_percent,
                c.resolution_status, c.fee_amount,
                case when c.category = 'SELBOX' then 0::numeric
                    else c.source_amount + c.fee_amount end as company_amount
            from calculated as c
        )
        -- CASE does not execute the sorting/fee or optional exact-count branch
        -- when the bounded probe exceeds the cap. All work uses one snapshot.
        select case when $17::boolean and (select value from candidate_count) > 10000
            then null::jsonb
        else jsonb_build_object(
            'rows', (
                select coalesce(jsonb_agg(
                    to_jsonb(r) || jsonb_build_object(
                        'source_amount', r.source_amount::text,
                        'quantity', r.quantity::text,
                        'fee_base', r.fee_base::text,
                        'fee_rate_percent', r.fee_rate_percent::text,
                        'fee_amount', r.fee_amount::text,
                        'company_amount', r.company_amount::text
                    ) order by r.%2$I %1$s nulls %6$s, r.source %7$s, r.source_row_id %7$s
                ), '[]'::jsonb)
                from result_rows as r
            ),
            'total_count', case when $11::boolean then
                case when $17::boolean then (select value::text from candidate_count)
                else public.transaction_count(
                $1::date, $2::date, $3::uuid[], $4::text[],
                $5::text[], $6::text[], $7::text[], $12::boolean,
                $13::text[], $14::text[], $15::text[], $16::text[]
                ) end
            end
        ) end
    $query$, sort_direction, sort_column, source_order, candidate_materialization, candidate_cap,
        sort_nulls, tie_direction, marketplace_prefix, marketplace_predicate, marketplace_suffix)
    into result
    using p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_sources, p_types, candidate_limit, p_limit, p_offset, p_include_count,
        p_fee_applicable, p_search_skus, p_search_types, p_search_marketplaces, p_search_sources,
        p_order_by = 'amount';
    if result is null then
        raise exception 'Amount ordering is limited to 10,000 matching transactions. Narrow your filters or order by date.'
            using errcode = '22023';
    end if;
    return result;
end;
$$;
revoke all on function public.transaction_page(
    integer, bigint, text, date, date, uuid[], text[],
    text[], text[], text[], boolean, boolean, text, text[], text[], text[], text[]
) from public,
anon,
authenticated,
service_role;
