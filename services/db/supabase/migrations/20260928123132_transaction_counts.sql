create type private.transaction_filter as (
    date_from date, date_to date, companies uuid [], skus text [], markets text [], sources text [],
    types text [], fee_applicable boolean, search_skus text [], search_types text [],
    search_markets text [], search_sources text [], currency text
);

-- Share the same predicate for fully hydrated pages and unpriced summary inputs.
-- Empty selection lists are unrestricted; empty search sets have no matches.
create function private.matches_transaction(
    f private.transaction_filter, activity_at timestamptz, company uuid, sku text, market text,
    source text, kind text, currency text, fee_base numeric
) returns boolean language sql immutable parallel safe as $$
    select (f.companies is null or company=any(f.companies))
        and (f.date_from is null or activity_at>=f.date_from::timestamp at time zone 'UTC')
        and (f.date_to is null or activity_at<(f.date_to+1)::timestamp at time zone 'UTC')
        and (f.currency is null or currency=f.currency)
        and (coalesce(cardinality(f.markets),0)=0 or market=any(f.markets))
        and (coalesce(cardinality(f.skus),0)=0 or sku=any(f.skus))
        and (coalesce(cardinality(f.sources),0)=0 or source=any(f.sources))
        and (coalesce(cardinality(f.types),0)=0 or kind=any(f.types))
        and (f.fee_applicable is null or (fee_base is not null)=f.fee_applicable)
        and case
            when f.search_skus is null and f.search_types is null
                and f.search_markets is null and f.search_sources is null then true
            when greatest(cardinality(f.search_skus), cardinality(f.search_types),
                cardinality(f.search_markets), cardinality(f.search_sources)) = 0 then false
            else sku=any(f.search_skus) or kind=any(f.search_types)
                or market=any(f.search_markets) or source=any(f.search_sources)
        end;
$$;

-- Count and aggregate the amounts first. Batch provenance, fee-period rows and
-- display fields are only needed when returning detailed records.
create function private.filtered_transaction_measures(f private.transaction_filter)
returns table (
    marketplace_name text, currency text, component_type text, activity_at timestamptz,
    activity_date date,
    company_id uuid,
    terms_version_id uuid,
    source_amount numeric,
    fee_base numeric,
    direct boolean
) language sql stable as $$
    select t.marketplace_name::text, t.currency, a.amount_type::text, t.posted_at, t.posted_date,
        owner.company_id::uuid, owner.terms_version_id::uuid, a.amount::numeric, a.fee_base::numeric, true
    from private.finances_transactions t
    join private.source_units u on u.current_version_id=t.version_id and u.source='FINANCES'
    join private.finances_amounts a on a.version_id=t.version_id
    left join private.current_sku_terms owner on a.route='SKU' and a.sku=owner.sku
    where t.is_activity and (a.route='SELBOX' or (a.route='SKU' and owner.company_id is not null))
        and private.matches_transaction(f, t.posted_at, owner.company_id, a.sku,
            t.marketplace_name, 'FINANCES', a.amount_type, t.currency, a.fee_base)
    union all
    select r.marketplace_name, r.currency, r.component_type, r.posted_at, r.posted_date,
        r.company_id, null::uuid, r.base_amount+r.tax_amount, null::numeric, false
    -- All reference outputs inherit their posting date and instant from an activity
    -- header. Obtain a safe local-date envelope for the UTC filters, even around
    -- midnight. Historical headers can widen it harmlessly. The final predicate
    -- still compares the output's exact UTC instant.
    from (
        select min(h.posted_date) as first_day, max(h.posted_date) + 1 as until_day
        from private.finances_transactions h
        where (f.date_from is not null or f.date_to is not null) and h.is_activity
            and (f.date_from is null or h.posted_at >= f.date_from::timestamp at time zone 'UTC')
            and (f.date_to is null or h.posted_at < (f.date_to + 1)::timestamp at time zone 'UTC')
            and (coalesce(cardinality(f.markets),0)=0 or h.marketplace_name=any(f.markets))
            and (f.currency is null or h.currency=f.currency)
    ) dates
    cross join lateral private.indirect_financial_amounts(null, null, dates.first_day, dates.until_day,
        case when cardinality(f.markets)=1 then f.markets[1] end) r
    where (dates.first_day is not null or (f.date_from is null and f.date_to is null))
        and r.outcome in ('COMPANY','SELBOX') and private.matches_transaction(
        f, r.posted_at, r.company_id, r.sku, r.marketplace_name, r.source, r.component_type, r.currency, null);
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
declare
    direct_rows bigint;
    scope private.transaction_filter := row(
        p_date_from, p_date_to, private.transaction_company_scope(p_company_ids), p_skus, p_marketplaces,
        p_sources, p_types, p_fee_applicable, p_search_skus, p_search_types,
        p_search_marketplaces, p_search_sources, p_currency);
begin
    perform private.validate_live_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces, p_sources,
        p_types, p_search_skus, p_search_types, p_search_marketplaces, p_search_sources, p_currency, false
    );
    if cardinality(scope.companies)=0 then return '0'; end if;
    -- Give the direct scan its own aggregate plan, without the reference CTEs.
    select count(*) into direct_rows from private.filtered_transaction_measures(scope) where direct;
    return (direct_rows + (select count(*) from private.filtered_transaction_measures(scope) where not direct))::text;
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

-- Pages and exact counts use the same filters. Each amount references one header,
-- so PostgreSQL can skip the left join when counting amount-only filters.
create function private.filtered_finances_amounts(
    p_date_from date, p_date_to date, p_skus text[], p_marketplaces text[], p_types text[],
    p_search_skus text[], p_search_types text[], p_search_marketplaces text[]
) returns table (id uuid, posted_at timestamptz, amount numeric)
language sql stable security invoker as $$
    select a.id::uuid, t.posted_at, a.amount::numeric
    from private.finances_amounts a left join private.finances_transactions t using(version_id)
    where (select private.financial_account_visible())
        and (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
        and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
        and (coalesce(cardinality(p_skus), 0) = 0 or a.sku = any(p_skus))
        and (coalesce(cardinality(p_marketplaces), 0) = 0
            or t.marketplace_name = any(p_marketplaces))
        and (coalesce(cardinality(p_types), 0) = 0 or a.amount_type = any(p_types))
        and (
            (p_search_skus is null and p_search_types is null and p_search_marketplaces is null)
            or a.sku = any(p_search_skus) or a.amount_type = any(p_search_types)
            or t.marketplace_name = any(p_search_marketplaces)
        );
$$;

-- The publisher verifies each header's amount_count against its immutable rows.
-- Summing headers answers date/market counts without reading every amount. Only
-- administrators can read this account-wide aggregate through the application.
create function private.finances_header_count(
    p_date_from date, p_date_to date, p_marketplaces text[]
) returns text language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    return (
        select coalesce(sum(t.amount_count), 0)::text from private.finances_transactions t
        where (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
            and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
            and (coalesce(cardinality(p_marketplaces), 0) = 0 or t.marketplace_name = any(p_marketplaces))
    );
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
    if coalesce(cardinality(p_skus), 0) = 0 and coalesce(cardinality(p_types), 0) = 0
        and p_search_skus is null and p_search_types is null and p_search_marketplaces is null
        and private.is_administrator() then
        return private.finances_header_count(p_date_from, p_date_to, p_marketplaces);
    end if;
    return (
        select count(*)::text from private.filtered_finances_amounts(
            p_date_from, p_date_to, p_skus, p_marketplaces, p_types,
            p_search_skus, p_search_types, p_search_marketplaces
        )
    );
end;
$$;

revoke all on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text[], text[], text[]
) from public, anon, authenticated, service_role;
