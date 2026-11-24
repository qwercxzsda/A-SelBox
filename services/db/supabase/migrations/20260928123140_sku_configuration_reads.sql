-- Return the complete catalog in one scalar JSON value, unaffected by REST row limits.
-- Only a currently registered administrator can call this RPC. Members
-- obtain their SKU choices from company_skus instead. Keep SECURITY INVOKER and
-- authenticate against database state, not caller-controlled role metadata.
-- Seek past every occurrence of the previous SKU. Its qualifying activity may
-- be on any retained version, even if that version is no longer current.
create function public.sku_filter_options() returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    return (
        with recursive finance_skus(sku) as (
            (select a.sku from private.finances_amounts a
             join private.finances_transactions t using(version_id)
             where a.sku is not null and t.is_activity order by a.sku, a.version_id limit 1)
            union all
            select next_sku.sku from finance_skus previous
            cross join lateral (
                select a.sku from private.finances_amounts a
                join private.finances_transactions t using(version_id)
                where a.sku > previous.sku and t.is_activity order by a.sku, a.version_id limit 1
            ) next_sku
        ), sku_values as (
            select sku from finance_skus
            union all
            select r.sku from private.inventory_ledger_rows r
            join private.source_units u on u.current_version_id = r.version_id
            union all
            select sku from private.information_products
            union all
            select native_id from public.assignment_keys where kind='SKU'
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

-- Configuration reads include unregistered imports and incomplete current settings.
-- Administrator batches validate changed SKUs; these reads still diagnose all
-- known SKUs so unrelated ownership and fee gaps remain visible for payouts.
-- Source publication remains independent: later imports may create new gaps.

create function private.sku_configuration_required_dates(p_skus text[])
returns table (sku text, marketplace_name text, activity_date date)
language sql stable security invoker set search_path = '' as $$
    select distinct a.sku, t.marketplace_name::text, t.posted_date
    from private.finances_amounts as a
    join private.finances_transactions as t using(version_id)
    join private.source_units as u on u.current_version_id=a.version_id
    where a.sku = any(p_skus) and a.fee_base is not null and t.is_activity;
$$;

-- Both read diagnostics and write validation share the same source/terms query.
-- Missing dates are compressed after coverage checks, so separate valid periods
-- may cover an otherwise contiguous requirement without producing a false gap.
create function private.sku_configuration_items(p_skus text[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
    with identities as materialized (
        select selected.sku, s.id as sku_id, v.id as terms_version_id, v.company_id
        from unnest(p_skus) as selected(sku)
        left join public.assignment_keys as s on s.kind='SKU' and s.native_id = selected.sku
        left join public.assignment_versions as v on v.id = s.current_version_id
    ), periods as materialized (
        select i.sku, p.marketplace_name, p.valid_period, p.fee_rate_percent
        from identities as i
        join public.sku_fee_periods as p on p.assignment_version_id = i.terms_version_id
    ), required_dates as materialized (
        select sku, marketplace_name, activity_date
        from private.sku_configuration_required_dates(p_skus)
    ), date_groups as (
        select sku, marketplace_name, activity_date,
            activity_date - row_number() over (
                partition by sku, marketplace_name order by activity_date
            )::integer as consecutive_group
        from required_dates
    ), requirements as (
        select sku, marketplace_name, min(activity_date) as valid_from,
            max(activity_date) + 1 as valid_to
        from date_groups group by sku, marketplace_name, consecutive_group
    ), missing_dates as (
        select d.sku, d.marketplace_name, d.activity_date
        from required_dates as d
        where not exists (
            select 1 from periods as p
            where p.sku = d.sku and p.marketplace_name = d.marketplace_name
                and p.valid_period @> d.activity_date
        )
    ), missing_groups as (
        select sku, marketplace_name, activity_date,
            activity_date - row_number() over (
                partition by sku, marketplace_name order by activity_date
            )::integer as consecutive_group
        from missing_dates
    ), issues as (
        select sku, 'missing_company'::text as kind, null::text as marketplace_name,
            null::date as valid_from, null::date as valid_to
        from identities where company_id is null
        union all
        select sku, 'missing_fee', marketplace_name, min(activity_date), max(activity_date) + 1
        from missing_groups group by sku, marketplace_name, consecutive_group
    ), period_items as (
        select sku, jsonb_agg(jsonb_build_object(
            'marketplace_name', marketplace_name,
            'valid_from', lower(valid_period), 'valid_to', upper(valid_period),
            'fee_rate_percent', fee_rate_percent::text
        ) order by marketplace_name collate "C", lower(valid_period)) as items
        from periods group by sku
    ), requirement_items as (
        select sku, jsonb_agg(jsonb_build_object(
            'marketplace_name', marketplace_name, 'valid_from', valid_from, 'valid_to', valid_to
        ) order by marketplace_name collate "C", valid_from) as items
        from requirements group by sku
    ), issue_items as (
        select sku, jsonb_agg(jsonb_build_object(
            'sku', sku, 'kind', kind, 'marketplace_name', marketplace_name,
            'valid_from', valid_from, 'valid_to', valid_to
        ) order by kind, marketplace_name collate "C", valid_from) as items
        from issues group by sku
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
        'sku', i.sku, 'sku_id', i.sku_id, 'company_id', i.company_id,
        'terms_version_id', i.terms_version_id, 'periods', coalesce(p.items, '[]'::jsonb),
        'requirements', coalesce(r.items, '[]'::jsonb), 'issues', coalesce(e.items, '[]'::jsonb)
    ) order by i.sku collate "C"), '[]'::jsonb))
    from identities i
    left join period_items p using (sku)
    left join requirement_items r using (sku)
    left join issue_items e using (sku);
$$;

create function private.read_sku_configuration() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare selected_skus text[];
begin
    if private.is_administrator() then
        select coalesce(array_agg(value), '{}'::text[]) into selected_skus
        from jsonb_array_elements_text(public.sku_filter_options()->'values');
    elsif private.is_member() then
        select coalesce(array_agg(o.sku), '{}'::text[]) into selected_skus
        from private.current_owned_sku_terms() as o;
    else
        raise exception 'Application account access required' using errcode = '42501';
    end if;
    return private.sku_configuration_items(selected_skus);
end;
$$;

create function public.sku_configuration() returns jsonb
language sql stable security invoker set search_path = '' as $$
    select private.read_sku_configuration();
$$;
