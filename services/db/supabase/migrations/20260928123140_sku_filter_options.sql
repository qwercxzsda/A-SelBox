-- Return the complete catalog in one scalar JSON value, unaffected by REST row limits.
-- Only a currently registered administrator can call this RPC. Company members
-- obtain their SKU choices from company_skus instead. Keep SECURITY INVOKER and
-- authenticate against database state, not caller-controlled role metadata.
-- Native deterministic SKU-index seeks skip duplicate facts; the final C ordering
-- preserves exact names across both complete fact histories and the registry.
create function public.sku_filter_options() returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if not private.is_operator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    return (
        with recursive settlement_skus(sku) as (
            (
                select t.sku from private.settlement_transactions as t
                where t.sku is not null order by t.sku limit 1
            )
            union all
            select next_sku.sku
            from settlement_skus as previous_sku
            cross join lateral (
                select t.sku from private.settlement_transactions as t
                where t.sku > previous_sku.sku order by t.sku limit 1
            ) as next_sku
        ),
        kiosk_skus(sku) as (
            (
                select t.sku from private.data_kiosk_transactions as t
                where t.sku is not null order by t.sku limit 1
            )
            union all
            select next_sku.sku
            from kiosk_skus as previous_sku
            cross join lateral (
                select t.sku from private.data_kiosk_transactions as t
                where t.sku > previous_sku.sku order by t.sku limit 1
            ) as next_sku
        ),
        sku_values as (
            select s.sku from settlement_skus as s
            union all
            select k.sku from kiosk_skus as k
            union all
            select s.sku from public.seller_skus as s
        ),
        distinct_skus as (
            select distinct s.sku collate "C" as sku
            from sku_values as s where s.sku is not null
        )
        select jsonb_build_object(
            'values', coalesce(jsonb_agg(s.sku order by s.sku collate "C"), '[]'::jsonb)
        )
        from distinct_skus as s
    );
end;
$$;
revoke all on function public.sku_filter_options()
from public, anon, authenticated, service_role;
