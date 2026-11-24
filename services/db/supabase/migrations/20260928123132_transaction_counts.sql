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
language plpgsql stable security invoker set search_path = '' as $$
begin
    perform private.validate_transaction_filters(p_date_from,p_date_to,p_company_ids,p_skus,p_marketplaces,p_sources,p_types);
    perform private.validate_transaction_filters(null,null,null,p_search_skus,p_search_marketplaces,p_search_sources,p_search_types);
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid currency' using errcode='22023'; end if;
    return query select c.*
    from private.visible_company_components(p_date_from,p_date_to,p_marketplaces,p_currency,p_company_ids) c
    where (coalesce(cardinality(p_skus),0)=0 or c.sku=any(p_skus))
        and (coalesce(cardinality(p_sources),0)=0 or c.source=any(p_sources))
        and (coalesce(cardinality(p_types),0)=0 or c.component_type=any(p_types))
        and (p_fee_applicable is null or (c.fee_base is not null)=p_fee_applicable)
        and ((p_search_skus is null and p_search_types is null and p_search_marketplaces is null and p_search_sources is null)
            or c.sku=any(p_search_skus) or c.component_type=any(p_search_types)
            or c.marketplace_name=any(p_search_marketplaces) or c.source=any(p_search_sources));
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
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    return (select count(*)::text from private.filtered_components(p_date_from,p_date_to,p_company_ids,p_skus,p_marketplaces,p_sources,p_types,p_fee_applicable,p_search_skus,p_search_types,p_search_marketplaces,p_search_sources,p_currency));
end;
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
        return (
            select count(*)::text from private.finances_component_details as t
            where (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
                and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and (
                    (p_search_skus is null and p_search_types is null
                        and p_search_marketplaces is null)
                    or t.sku = any(p_search_skus) or t.component_type = any(p_search_types)
                    or t.marketplace_name = any(p_search_marketplaces)
                )
        );
end;
$$;

revoke all on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text[], text[], text[]
) from public, anon, authenticated, service_role;
