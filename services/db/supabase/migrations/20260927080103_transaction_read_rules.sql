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
    if p_marketplaces is not null and not (p_marketplaces <@ array[
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    ]::text[]) then
        raise exception 'Unsupported marketplace selection' using errcode = '22023';
    end if;
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
-- source pointers for authenticated company members. It does not grant access.
-- Call once before custom planning, or through a scalar InitPlan in page SQL.
create function private.member_policy_covers_current_version(p_relation regclass)
returns boolean
language sql stable security invoker set search_path = '' as $$
    select case when p_relation in (
        'private.settlement_transactions'::regclass,
        'private.data_kiosk_transactions'::regclass
    ) then current_user = 'authenticated'
        and not private.is_operator()
        and pg_catalog.row_security_active(p_relation)
    else false end;
$$;

revoke all on function private.member_policy_covers_current_version(regclass)
from public, anon, authenticated, service_role;

revoke all on function private.validate_transaction_filters(
    date, date, uuid[], text[], text[], text[], text[], boolean
), private.validate_page_bounds(integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function private.validate_transaction_filters(
    date, date, uuid[], text[], text[], text[], text[], boolean
), private.validate_page_bounds(integer, bigint),
private.member_policy_covers_current_version(regclass) to authenticated;
