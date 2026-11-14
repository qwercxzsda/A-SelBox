-- Count the same eligible source facts as transaction_page, without projecting
-- ownership or resolving fees. Company selection
-- still resolves current ownership before counting. Existing fact RLS remains.
-- Applicability reads the normalized fee base; it does not classify source types.
-- Only authenticated non-administrators with active fact RLS omit the duplicate
-- current-pointer EXISTS: their unchanged fact policies already require it.
-- Revalidate this optimization whenever the authenticated fact policies change.
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
declare
    finances_policy_is_sufficient boolean;
    kiosk_policy_is_sufficient boolean;
begin
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter uppercase code' using errcode = '22023';
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
    -- Bind the actor checks as known custom-plan parameters. This lets the
    -- planner remove the redundant member check or expose the administrator EXISTS
    -- as a semi-join instead of retaining a per-row subplan behind an OR.
    finances_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.finances_transaction_components'::regclass
    );
    kiosk_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.data_kiosk_day_components'::regclass
    );
    return (
        -- Each COUNT is bigint; SUM(bigint) is numeric, so combining sources
        -- does not introduce an integer-width bound before conversion to text.
        select sum(source_counts.row_count)::text
        from (
            select count(*) as row_count
            from private.finances_activity_components as t
            where t.category in ('FINANCES', 'SELBOX')
                and (
                    finances_policy_is_sufficient
                    or t.is_current
                )
                and (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
                and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
                and (p_currency is null or t.currency = p_currency)
                and (
                    coalesce(cardinality(p_company_ids), 0) = 0
                    or exists (
                        select 1 from public.company_skus as o
                        where t.category <> 'SELBOX' and o.sku = t.sku and o.company_id = any(p_company_ids)
                    )
                )
                and (coalesce(cardinality(p_skus), 0) = 0
                    or (t.category <> 'SELBOX' and t.sku = any(p_skus)))
                and (
                    coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces)
                )
                and (
                    coalesce(cardinality(p_sources), 0) = 0
                    or 'FINANCES'::text = any(p_sources)
                )
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and (
                    p_fee_applicable is null
                    or (t.fee_base is not null) = p_fee_applicable
                )
                and (
                    (p_search_skus is null and p_search_types is null
                        and p_search_marketplaces is null and p_search_sources is null)
                    or t.sku = any(p_search_skus) or t.component_type = any(p_search_types)
                    or t.marketplace_name = any(p_search_marketplaces) or 'FINANCES'::text = any(p_search_sources)
                )
            union all
            select count(*) as row_count
            from private.data_kiosk_component_details as t
            where t.category = 'DATA_KIOSK'
                and (
                    kiosk_policy_is_sufficient
                    or exists (
                        select 1 from private.data_kiosk_days as h
                        where h.current_version_id = t.version_id
                    )
                )
                and (p_date_from is null or t.activity_at >= p_date_from::timestamp at time zone 'UTC')
                and (p_date_to is null or t.activity_at < (p_date_to + 1)::timestamp at time zone 'UTC')
                and (p_currency is null or t.currency = p_currency)
                and (
                    coalesce(cardinality(p_company_ids), 0) = 0
                    or exists (
                        select 1 from public.company_skus as o
                        where t.category <> 'SELBOX' and o.sku = t.sku and o.company_id = any(p_company_ids)
                    )
                )
                and (coalesce(cardinality(p_skus), 0) = 0
                    or (t.category <> 'SELBOX' and t.sku = any(p_skus)))
                and (
                    coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces)
                )
                and (
                    coalesce(cardinality(p_sources), 0) = 0
                    or 'DATA_KIOSK'::text = any(p_sources)
                )
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and (p_fee_applicable is null or (t.fee_base is not null) = p_fee_applicable)
                and (
                    (p_search_skus is null and p_search_types is null
                        and p_search_marketplaces is null and p_search_sources is null)
                    or t.sku = any(p_search_skus) or t.component_type = any(p_search_types)
                    or t.marketplace_name = any(p_search_marketplaces) or 'DATA_KIOSK'::text = any(p_search_sources)
                )
        ) as source_counts
    );
end;
$$;
revoke all on function public.transaction_count(
    date, date, uuid[], text[], text[], text[], text[], boolean,
    text[], text[], text[], text[], text
)
from public, anon, authenticated, service_role;

-- Count the same raw facts as source_transaction_page without metadata joins.
-- Full raw source history is administrator-only; fact RLS remains unchanged for
-- the separate financial transaction reads used by members.
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
    if p_dataset is null or p_dataset not in ('finances', 'data_kiosk') then
        raise exception 'Dataset must be finances or data_kiosk' using errcode = '22023';
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
    if p_dataset = 'finances' then
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
    end if;
    return (
        select count(*)::text from private.data_kiosk_component_details as t
        where (p_date_from is null or t.activity_at >= p_date_from::timestamp at time zone 'UTC')
            and (p_date_to is null or t.activity_at < (p_date_to + 1)::timestamp at time zone 'UTC')
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
