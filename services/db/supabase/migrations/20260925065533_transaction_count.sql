-- Count the same eligible source facts as transaction_page, without joining
-- source metadata, projecting ownership, or resolving fees. Company selection
-- still resolves current ownership before counting. Existing fact RLS remains.
-- Applicability uses source-specific Type codes, exposing existing Type/date
-- indexes. Actual fee bases and rates are resolved separately by the page.
-- Only authenticated non-operators with active fact RLS omit the duplicate
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
    p_search text default null
) returns text
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    settlement_policy_is_sufficient boolean;
    kiosk_policy_is_sufficient boolean;
    search_pattern text;
begin
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_sources, p_types
    );
    search_pattern := private.literal_search_pattern(p_search);
    -- Bind the actor checks as known custom-plan parameters. This lets the
    -- planner remove the redundant member check or expose the operator EXISTS
    -- as a semi-join instead of retaining a per-row subplan behind an OR.
    settlement_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.settlement_transactions'::regclass
    );
    kiosk_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.data_kiosk_transactions'::regclass
    );
    return (
        -- Each COUNT is bigint; SUM(bigint) is numeric, so combining sources
        -- does not introduce an integer-width bound before conversion to text.
        select sum(source_counts.row_count)::text
        from (
            select count(*) as row_count
            from private.settlement_transactions as t
            where t.category = 'SETTLEMENT'
                and (
                    settlement_policy_is_sufficient
                    or exists (
                        select 1 from private.settlements as h
                        where h.current_version_id = t.version_id
                    )
                )
                and (p_date_from is null or t.posted_date >= p_date_from)
                and (p_date_to is null or t.posted_date <= p_date_to)
                and (
                    coalesce(cardinality(p_company_ids), 0) = 0
                    or exists (
                        select 1 from public.company_skus as o
                        where o.seller_namespace = t.seller_namespace
                            and o.sku = t.sku and o.company_id = any(p_company_ids)
                    )
                )
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (
                    coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces)
                )
                and (
                    coalesce(cardinality(p_sources), 0) = 0
                    or 'SETTLEMENT'::text = any(p_sources)
                )
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and (
                    p_fee_applicable is null
                    or (t.component_type in ('PRODUCT_SALES', 'PRODUCT_REFUNDS')) = p_fee_applicable
                )
                and private.visible_transaction_search_matches(
                    search_pattern, 'SETTLEMENT', t.sku, t.component_type,
                    t.marketplace_name, t.currency
                )
            union all
            select count(*) as row_count
            from private.data_kiosk_transactions as t
            where t.amount <> 0
                and (
                    kiosk_policy_is_sufficient
                    or exists (
                        select 1 from private.data_kiosk_days as h
                        where h.current_version_id = t.version_id
                    )
                )
                and (p_date_from is null or t.activity_date >= p_date_from)
                and (p_date_to is null or t.activity_date <= p_date_to)
                and (
                    coalesce(cardinality(p_company_ids), 0) = 0
                    or exists (
                        select 1 from public.company_skus as o
                        where o.seller_namespace = t.seller_namespace
                            and o.sku = t.sku and o.company_id = any(p_company_ids)
                    )
                )
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (
                    coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces)
                )
                and (
                    coalesce(cardinality(p_sources), 0) = 0
                    or 'DATA_KIOSK'::text = any(p_sources)
                )
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and (p_fee_applicable is null or (t.component_type = 'NET_PRODUCT_SALES') = p_fee_applicable)
                and private.visible_transaction_search_matches(
                    search_pattern, 'DATA_KIOSK', t.sku, t.component_type,
                    t.marketplace_name, t.currency
                )
        ) as source_counts
    );
end;
$$;
revoke all on function public.transaction_count(
    date, date, uuid[], text[], text[], text[], text[], boolean, text
)
from public, anon, authenticated, service_role;
grant execute on function public.transaction_count(
    date, date, uuid[], text[], text[], text[], text[], boolean, text
)
to authenticated;
