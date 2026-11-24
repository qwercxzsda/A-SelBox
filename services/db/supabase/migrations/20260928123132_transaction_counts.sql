-- Internal, inlinable projection shared by sorting, counting and aggregation.
-- The caller supplies the result of transaction_company_scope. Application roles
-- have no direct grant on this helper.
create function private.filtered_components(
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_sources text[] default null,
    p_types text[] default null,
    p_fee_applicable boolean default null,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null,
    p_search_sources text[] default null,
    p_currency text default null
) returns setof public.live_company_components
language sql stable security invoker as $$
    select c.* from private.company_components c
    where (p_company_ids is null or c.company_id=any(p_company_ids))
        and (p_date_from is null or c.activity_at>=p_date_from::timestamp at time zone 'UTC')
        and (p_date_to is null or c.activity_at<(p_date_to+1)::timestamp at time zone 'UTC')
        and (p_currency is null or c.currency=p_currency)
        and (coalesce(cardinality(p_marketplaces),0)=0 or c.marketplace_name=any(p_marketplaces))
        and (coalesce(cardinality(p_skus),0)=0 or c.sku=any(p_skus))
        and (coalesce(cardinality(p_sources),0)=0 or c.source=any(p_sources))
        and (coalesce(cardinality(p_types),0)=0 or c.component_type=any(p_types))
        and (p_fee_applicable is null or (c.fee_base is not null)=p_fee_applicable)
        and ((p_search_skus is null and p_search_types is null and p_search_marketplaces is null and p_search_sources is null)
            or c.sku=any(p_search_skus) or c.component_type=any(p_search_types)
            or c.marketplace_name=any(p_search_marketplaces) or c.source=any(p_search_sources));
$$;

create function private.validate_live_transaction_filters(
    p_date_from date, p_date_to date, p_company_ids uuid[], p_skus text[], p_marketplaces text[],
    p_sources text[], p_types text[], p_search_skus text[], p_search_types text[],
    p_search_marketplaces text[], p_search_sources text[], p_currency text, p_require_date boolean
) returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
    perform private.validate_transaction_filters(
        p_date_from,p_date_to,p_company_ids,p_skus,p_marketplaces,p_sources,p_types,p_require_date
    );
    perform private.validate_transaction_filters(
        null,null,null,p_search_skus,p_search_marketplaces,p_search_sources,p_search_types
    );
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter uppercase code' using errcode='22023';
    end if;
end;
$$;

create function private.read_transaction_count(
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_sources text[] default null,
    p_types text[] default null,
    p_fee_applicable boolean default null,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null,
    p_search_sources text[] default null,
    p_currency text default null
) returns text
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare companies uuid[] := private.transaction_company_scope(p_company_ids);
begin
    perform private.validate_live_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces, p_sources,
        p_types, p_search_skus, p_search_types, p_search_marketplaces, p_search_sources, p_currency, false
    );
    if cardinality(companies)=0 then return '0'; end if;
    return (
        select count(*)::text from private.filtered_components(
            p_date_from, p_date_to, companies, p_skus, p_marketplaces, p_sources, p_types,
            p_fee_applicable, p_search_skus, p_search_types, p_search_marketplaces,
            p_search_sources, p_currency
        )
    );
end;
$$;

create function public.transaction_count(
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_sources text[] default null,
    p_types text[] default null,
    p_fee_applicable boolean default null,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null,
    p_search_sources text[] default null,
    p_currency text default null
) returns text
language sql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
    select private.read_transaction_count(
        p_date_from, p_date_to, p_company_ids, p_skus,
        p_marketplaces, p_sources, p_types, p_fee_applicable,
        p_search_skus, p_search_types, p_search_marketplaces, p_search_sources,
        p_currency
    );
$$;

create function public.source_transaction_count(
    p_dataset text,
    p_date_from date default null,
    p_date_to date default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_types text[] default null,
    p_search_skus text[] default null,
    p_search_types text[] default null,
    p_search_marketplaces text[] default null
) returns text
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if not private.financial_account_visible() then
        raise exception 'Administrator access is required' using errcode = '42501';
    end if;
    if p_dataset is null or p_dataset<>'finances' then
        raise exception 'Unknown Finances dataset' using errcode = '22023';
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
    -- Every amount has exactly one Finances header. Date and marketplace filters
    -- need that header. For amount-only filters the planner can omit the join.
    return (
        select count(*)::text
        from private.finances_amounts a left join private.finances_transactions t using(version_id)
        where (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
            and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
            and (coalesce(cardinality(p_skus), 0) = 0 or a.sku = any(p_skus))
            and (coalesce(cardinality(p_marketplaces), 0) = 0
                or t.marketplace_name = any(p_marketplaces))
            and (coalesce(cardinality(p_types), 0) = 0 or a.amount_type = any(p_types))
            and (
                (p_search_skus is null and p_search_types is null and p_search_marketplaces is null)
                or a.sku = any(p_search_skus) or a.amount_type = any(p_search_types)
                or t.marketplace_name = any(p_search_marketplaces)
            )
    );
end;
$$;

revoke all on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text[], text[], text[]
) from public, anon, authenticated, service_role;
