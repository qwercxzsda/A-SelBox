create index finances_posted_instant_idx on private.finances_transactions (posted_at);
create index finances_marketplace_instant_idx on private.finances_transactions (
    marketplace_name, posted_at
);
create index finances_amount_type_idx on private.finances_amounts (amount_type);

-- Shared rules for the bounded transaction read API.

-- Validation runs once before each RPC's query, never once per source fact.
create function private.validate_transaction_filters(
    p_date_from date,
    p_date_to date,
    p_company_ids uuid[],
    p_skus text[],
    p_marketplaces text[],
    p_sources text[] default null,
    p_types text[] default null,
    p_require_date boolean default false
) returns void
language plpgsql immutable parallel safe security invoker set search_path = '' as $$
begin
    if p_require_date and p_date_from is null and p_date_to is null then
        raise exception 'At least one date bound is required' using errcode = '22023';
    end if;
    if (p_date_from is not null and not isfinite(p_date_from))
        or (p_date_to is not null and not isfinite(p_date_to)) then
        raise exception 'Date bounds must be finite calendar dates' using errcode = '22023';
    end if;
    if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
        raise exception 'The start date must be on or before the end date' using errcode = '22023';
    end if;
    if array_ndims(p_company_ids) > 1 or array_ndims(p_skus) > 1
        or array_ndims(p_marketplaces) > 1 or array_ndims(p_sources) > 1
        or array_ndims(p_types) > 1 then
        raise exception 'Selection filters must be one-dimensional arrays' using errcode = '22023';
    end if;
    if array_position(p_company_ids, null) is not null or array_position(p_skus, null) is not null
        or array_position(p_marketplaces, null) is not null or array_position(p_sources, null) is not null
        or array_position(p_types, null) is not null then
        raise exception 'Selection filters must not contain null values' using errcode = '22023';
    end if;
    -- Filters compare stored facts. Source vocabularies belong to preprocessing
    -- and table constraints; an unmatched filter value simply selects no rows.
end;
$$;

create function private.validate_page_bounds(p_limit integer, p_offset bigint default 0)
returns void
language plpgsql immutable parallel safe security invoker set search_path = '' as $$
begin
    if p_limit is null or p_limit < 1 or p_limit > 1000 then
        raise exception 'Page size must be between 1 and 1000' using errcode = '22023';
    end if;
    if p_offset is null or p_offset < 0 or p_offset > 9007199254740991 then
        raise exception 'Page offset must be a non-negative safe integer' using errcode = '22023';
    end if;
end;
$$;

-- This only recognizes the two fact policies that already enforce current
-- source pointers for authenticated members. It does not grant access.

revoke all on function private.validate_transaction_filters(
    date, date, uuid[], text[], text[], text[], text[], boolean
), private.validate_page_bounds(integer, bigint)
from public, anon, authenticated, service_role;

-- Pass the review filters into the administrator boundary before the ordered page is built.
create function private.read_financial_outcome_page(
    p_outcome text, p_month date, p_marketplace text, p_limit integer, p_offset bigint
) returns setof public.financial_outcomes
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    cutoff date := p_month;
    newest date;
    month_end date;
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_outcome is null or p_outcome not in ('COMPANY','DIFFERENCE','SELBOX') or
        (p_month is not null and (not isfinite(p_month) or extract(day from p_month) <> 1)) then
        raise exception 'Invalid financial review scope' using errcode='22023';
    end if;
    month_end := (p_month + interval '1 month')::date;
    -- If the newest day contains the complete requested prefix, every older day
    -- can be excluded. The existence check uses the same allocation and filters.
    if p_outcome = 'COMPANY' then
        select h.posted_date into newest from private.selected_finance_headers(null) h
        where h.is_activity and (p_month is null or h.posted_date between p_month and month_end - 1)
            and (p_marketplace is null or h.marketplace_name = p_marketplace)
        order by h.posted_date desc limit 1;
        if exists (
            select 1 from private.direct_financial_amounts(null,null) d
            where d.posted_date = newest and d.outcome = p_outcome
                and (p_marketplace is null or d.marketplace_name = p_marketplace)
            limit 1 offset p_offset+p_limit-1
        ) then
            cutoff := newest;
        end if;
    end if;
    return query
    select f.source, f.source_row_id, f.source_version_id, f.seller_namespace, f.amazon_scope,
        f.marketplace_name, f.currency, f.posted_date, f.component_type, f.outcome, f.selbox_group,
        f.reason, f.reference_id, f.sku, to_jsonb(f.skus), f.fnsku, f.asin, f.base_amount,
        f.tax_amount, f.company_id
    from private.financial_outcomes f
    where f.outcome = p_outcome
        and (cutoff is null or f.posted_date >= cutoff) and (month_end is null or f.posted_date < month_end)
        and (p_marketplace is null or f.marketplace_name = p_marketplace)
    order by f.posted_date desc, f.source_row_id, f.reason, f.marketplace_name
    limit p_limit offset p_offset;
end;
$$;

create function public.financial_outcome_page(
    p_outcome text, p_month date default null, p_marketplace text default null,
    p_limit integer default 51, p_offset bigint default 0
) returns setof public.financial_outcomes
language sql stable security invoker set search_path = '' as $$
    select * from private.read_financial_outcome_page(p_outcome,p_month,p_marketplace,p_limit,p_offset);
$$;

create function private.read_financial_review_month_page(
    p_month date, p_marketplace text, p_limit integer, p_offset bigint
) returns setof public.financial_review_monthly
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    if p_month is not null and (not isfinite(p_month) or extract(day from p_month) <> 1) then
        raise exception 'Choose the first day of a review month' using errcode='22023';
    end if;
    return query
    select m.* from private.monthly_financial_totals m
    where (p_month is null or m.month = p_month) and (p_marketplace is null or m.marketplace_name = p_marketplace)
    order by m.month desc,m.seller_namespace,m.amazon_scope,m.marketplace_name,m.currency
    limit p_limit offset p_offset;
end;
$$;
create function public.financial_review_month_page(
    p_month date default null, p_marketplace text default null,
    p_limit integer default 51, p_offset bigint default 0
) returns setof public.financial_review_monthly
language sql stable security invoker set search_path = '' as $$
    select * from private.read_financial_review_month_page(p_month,p_marketplace,p_limit,p_offset);
$$;
