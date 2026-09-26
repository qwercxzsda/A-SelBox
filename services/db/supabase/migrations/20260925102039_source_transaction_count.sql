-- Count the same raw facts as source_transaction_page without metadata joins.
-- Existing fact/version policies ensure every visible fact has a visible parent;
-- operators retain history/account rows and members retain only authorized facts.
create function public.source_transaction_count(
    p_dataset text,
    p_date_from date default null,
    p_date_to date default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_types text[] default null,
    p_search text default null
) returns text
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    search_pattern text;
begin
    if p_dataset is null or p_dataset not in ('settlement', 'data_kiosk') then
        raise exception 'Dataset must be settlement or data_kiosk' using errcode = '22023';
    end if;
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, null, p_skus, p_marketplaces, null, p_types
    );
    search_pattern := private.literal_search_pattern(p_search);
    if p_dataset = 'settlement' then
        return (
            select count(*)::text from private.settlement_transactions as t
            where (p_date_from is null or t.posted_date >= p_date_from)
                and (p_date_to is null or t.posted_date <= p_date_to)
                and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
                and private.visible_transaction_search_matches(
                    search_pattern, null, t.sku, t.component_type, t.marketplace_name, t.currency
                )
        );
    end if;
    return (
        select count(*)::text from private.data_kiosk_transactions as t
        where t.amount <> 0
            and (p_date_from is null or t.activity_date >= p_date_from)
            and (p_date_to is null or t.activity_date <= p_date_to)
            and (coalesce(cardinality(p_skus), 0) = 0 or t.sku = any(p_skus))
            and (coalesce(cardinality(p_marketplaces), 0) = 0
                or t.marketplace_name = any(p_marketplaces))
            and (coalesce(cardinality(p_types), 0) = 0 or t.component_type = any(p_types))
            and private.visible_transaction_search_matches(
                search_pattern, null, t.sku, t.component_type, t.marketplace_name, t.currency
            )
    );
end;
$$;

revoke all on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text
) from public, anon, authenticated, service_role;
grant execute on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text
) to authenticated;

notify pgrst, 'reload schema';
