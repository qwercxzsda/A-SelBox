create index finances_posted_instant_idx on private.finances_transactions (posted_at);
create index finances_marketplace_instant_idx on private.finances_transactions (
    marketplace_name, posted_at
);
-- Supports type filters alone and their intersection with an exact seller SKU.
create index finances_amount_type_idx on private.finances_amounts (amount_type, sku);

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

-- Financial review reads one marketplace. A mistyped name fails instead of reading nothing.
create function private.validate_review_marketplace(p_marketplace text)
returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
    if p_marketplace is null then
        raise exception 'Choose a review marketplace' using errcode = '22023';
    end if;
    perform p_marketplace::public.marketplace_name;
exception when check_violation then
    raise exception 'Unknown review marketplace' using errcode = '22023';
end;
$$;

-- One marketplace-year of review measures, summed across seller accounts and regions.
create function private.read_financial_review_months(p_marketplace text, p_year integer)
returns table (
    month date, currency text, measure text, reason text, selbox_group text,
    base_amount numeric, tax_amount numeric, amount_count bigint
)
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    year_start date;
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    perform private.validate_review_marketplace(p_marketplace);
    if p_year is null or p_year not between 1 and 9999 then
        raise exception 'Choose a calendar year' using errcode = '22023';
    end if;
    year_start := make_date(p_year, 1, 1);
    return query
    select o.month, o.currency, o.measure, o.reason, o.selbox_group,
        sum(o.base_amount), sum(o.tax_amount), sum(o.amount_count)::bigint
    from private.monthly_outcomes(
        year_start, (year_start + interval '1 year')::date, p_marketplace
    ) as o
    group by 1, 2, 3, 4, 5
    order by o.month, o.currency collate "C", o.measure collate "C", o.reason collate "C",
        o.selbox_group collate "C";
end;
$$;

create function public.financial_review_months(p_marketplace text, p_year integer)
returns table (
    month date, currency text, measure text, reason text, selbox_group text,
    base_amount numeric, tax_amount numeric, amount_count bigint
)
language sql stable security invoker set search_path = '' as $$
    select * from private.read_financial_review_months(p_marketplace, p_year);
$$;

-- The month drawer lists one marketplace-month of differences or SelBox types. Every
-- filter applies before the ordered page, so its row count equals the months RPC's
-- amount_count for the same outcome, reason and group. An unknown reason or group
-- code fails instead of reading nothing.
create function private.read_financial_outcome_page(
    p_outcome text, p_month date, p_marketplace text, p_reason text, p_selbox_group text,
    p_limit integer, p_offset bigint
) returns setof public.financial_outcomes
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    month_end date;
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    perform private.validate_review_marketplace(p_marketplace);
    if p_outcome is null or p_outcome not in ('DIFFERENCE', 'SELBOX')
        or p_month is null or not isfinite(p_month) or extract(day from p_month) <> 1
        or (p_reason is not null and p_outcome <> 'DIFFERENCE')
        or (p_selbox_group is not null and p_outcome <> 'SELBOX')
        or (p_reason is not null and not p_reason = any(private.difference_reasons()))
        or (
            p_selbox_group is not null
            and not p_selbox_group = any(enum_range(null::private.selbox_group)::text[])
        ) then
        raise exception 'Invalid financial review scope' using errcode = '22023';
    end if;
    month_end := (p_month + interval '1 month')::date;
    return query
    select f.source, f.source_row_id, f.source_version_id, f.seller_namespace, f.amazon_scope,
        f.marketplace_name, f.currency, f.posted_date, f.component_type, f.outcome, f.selbox_group,
        f.reason, f.reference_id, f.sku, to_jsonb(f.skus), f.fnsku, f.asin, f.base_amount,
        f.tax_amount, f.company_id
    from (
        select * from private.direct_financial_amounts(null, null)
        union all
        select * from private.indirect_financial_amounts(null, null, p_month, month_end, p_marketplace)
    ) as f
    where f.outcome = p_outcome
        and f.posted_date >= p_month and f.posted_date < month_end
        and f.marketplace_name = p_marketplace
        and (p_reason is null or f.reason = p_reason)
        and (p_selbox_group is null or f.selbox_group = p_selbox_group)
    order by f.posted_date desc, f.source_row_id, f.reason
    limit p_limit offset p_offset;
end;
$$;

create function public.financial_outcome_page(
    p_outcome text, p_month date, p_marketplace text, p_reason text default null,
    p_selbox_group text default null, p_limit integer default 50, p_offset bigint default 0
) returns setof public.financial_outcomes
language sql stable security invoker set search_path = '' as $$
    select * from private.read_financial_outcome_page(
        p_outcome, p_month, p_marketplace, p_reason, p_selbox_group, p_limit, p_offset
    );
$$;
