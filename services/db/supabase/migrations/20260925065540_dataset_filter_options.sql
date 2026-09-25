-- Option discovery needs source identities only; it never joins fee periods.
-- Raw datasets use their existing views so their historical and caller scope
-- remains identical. COLLATE C defines an unambiguous, stable text cursor order.
create function public.dataset_filter_options(
    p_dataset text,
    p_field text,
    p_limit integer default 1000,
    p_after text default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    settlement_policy_is_sufficient boolean;
    kiosk_policy_is_sufficient boolean;
begin
    if p_dataset is null or p_field is null or not (
        (p_dataset = 'live' and p_field in ('sku', 'marketplace_name', 'source', 'component_type'))
        or (p_dataset in ('settlement', 'data_kiosk')
            and p_field in ('sku', 'marketplace_name', 'component_type'))
        or (p_dataset = 'fees' and p_field = 'marketplace_name')
    ) then
        raise exception 'Unsupported dataset filter field' using errcode = '22023';
    end if;
    perform private.validate_page_bounds(p_limit);
    if p_after = '' then
        raise exception 'The option cursor must not be empty' using errcode = '22023';
    end if;
    settlement_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.settlement_transactions'::regclass
    );
    kiosk_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.data_kiosk_transactions'::regclass
    );
    return (
        with option_values as (
            select case p_field when 'sku' then t.sku::text
                when 'marketplace_name' then t.marketplace_name::text
                when 'source' then 'SETTLEMENT'::text
                when 'component_type' then t.component_type::text end as value
            from private.settlement_transactions as t
            where p_dataset = 'live' and t.category = 'SETTLEMENT'
                and (settlement_policy_is_sufficient or exists (
                    select 1 from private.settlements as h where h.current_version_id = t.version_id
                ))
            union all
            select case p_field when 'sku' then t.sku::text
                when 'marketplace_name' then t.marketplace_name::text
                when 'source' then 'DATA_KIOSK'::text
                when 'component_type' then t.component_type::text end
            from private.data_kiosk_transactions as t
            where p_dataset = 'live' and t.amount <> 0
                and (kiosk_policy_is_sufficient or exists (
                    select 1 from private.data_kiosk_days as h where h.current_version_id = t.version_id
                ))
            union all
            select case p_field when 'sku' then t.sku::text
                when 'marketplace_name' then t.marketplace_name::text
                when 'component_type' then t.component_type::text end
            from public.settlement_preprocess_entries as t where p_dataset = 'settlement'
            union all
            select case p_field when 'sku' then t.sku::text
                when 'marketplace_name' then t.marketplace_name::text
                when 'component_type' then t.component_type::text end
            from public.data_kiosk_preprocess_entries as t
            where p_dataset = 'data_kiosk' and t.amount <> 0
            union all
            select t.marketplace_name::text
            from public.current_sku_fee_periods as t where p_dataset = 'fees'
        ),
        selected as materialized (
            select distinct v.value collate "C" as value from option_values as v
            where v.value is not null and (p_after is null or v.value collate "C" > p_after collate "C")
            order by value limit p_limit + 1
        ),
        page as (
            select s.value from selected as s order by s.value collate "C" limit p_limit
        )
        select jsonb_build_object(
            'values', coalesce((select jsonb_agg(p.value order by p.value collate "C")
                from page as p), '[]'::jsonb),
            'next_cursor', case when (select count(*) from selected) > p_limit then (
                select p.value from page as p order by p.value collate "C" desc limit 1
            ) end
        )
    );
end;
$$;
revoke all on function public.dataset_filter_options(text, text, integer, text)
from public, anon, authenticated, service_role;
grant execute on function public.dataset_filter_options(text, text, integer, text) to authenticated;
