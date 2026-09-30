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
            select s.sku from public.skus as s
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
-- New administrator batches must cover every known SKU at validation time.
-- Source publication remains independent: later imports may create new gaps.

create function private.sku_configuration_required_dates(p_skus text[])
returns table (sku text, marketplace_name text, activity_date date)
language sql stable security invoker set search_path = '' as $$
    select t.sku, t.marketplace_name, t.posted_date
    from private.settlement_transactions as t
    where t.sku = any(p_skus) and t.category = 'SETTLEMENT'
        and private.settlement_fee_applicable(t.transaction_type, t.amount_type, t.amount_description)
        and exists (
            select 1 from private.settlements as s where s.current_version_id = t.version_id
        )
    union
    select t.sku, t.marketplace_name, t.activity_date
    from private.data_kiosk_transactions as t
    where t.sku = any(p_skus) and t.category <> 'SELBOX' and t.fee_base is not null
        and exists (
            select 1 from private.data_kiosk_days as d where d.current_version_id = t.version_id
        );
$$;

-- Both read diagnostics and write validation share the same source/terms query.
-- Missing dates are compressed after coverage checks, so separate valid periods
-- may cover an otherwise contiguous requirement without producing a false gap.
create function private.sku_configuration_items(p_skus text[]) returns jsonb
language sql stable security invoker set search_path = '' as $$
    with identities as materialized (
        select selected.sku, s.id as sku_id, v.id as terms_version_id, v.company_id
        from unnest(p_skus) as selected(sku)
        left join public.skus as s on s.sku = selected.sku
        left join public.sku_terms_versions as v on v.id = s.current_terms_version_id
    ), periods as materialized (
        select i.sku, p.marketplace_name, p.valid_period, p.fee_rate_percent
        from identities as i
        join public.sku_fee_periods as p on p.terms_version_id = i.terms_version_id
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
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
        'sku', i.sku, 'sku_id', i.sku_id, 'company_id', i.company_id,
        'terms_version_id', i.terms_version_id,
        'periods', coalesce((
            select jsonb_agg(jsonb_build_object(
                'marketplace_name', p.marketplace_name,
                'valid_from', lower(p.valid_period), 'valid_to', upper(p.valid_period),
                'fee_rate_percent', p.fee_rate_percent::text
            ) order by p.marketplace_name collate "C", lower(p.valid_period))
            from periods as p where p.sku = i.sku
        ), '[]'::jsonb),
        'requirements', coalesce((
            select jsonb_agg(jsonb_build_object(
                'marketplace_name', r.marketplace_name,
                'valid_from', r.valid_from, 'valid_to', r.valid_to
            ) order by r.marketplace_name collate "C", r.valid_from)
            from requirements as r where r.sku = i.sku
        ), '[]'::jsonb),
        'issues', coalesce((
            select jsonb_agg(jsonb_build_object(
                'sku', e.sku, 'kind', e.kind, 'marketplace_name', e.marketplace_name,
                'valid_from', e.valid_from, 'valid_to', e.valid_to
            ) order by e.kind, e.marketplace_name collate "C", e.valid_from)
            from issues as e where e.sku = i.sku
        ), '[]'::jsonb)
    ) order by i.sku collate "C"), '[]'::jsonb))
    from identities as i;
$$;

create function private.read_sku_configuration() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare selected_skus text[];
begin
    if private.is_operator() then
        select coalesce(array_agg(value), '{}'::text[]) into selected_skus
        from jsonb_array_elements_text(public.sku_filter_options()->'values');
    elsif private.is_company_member() then
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
