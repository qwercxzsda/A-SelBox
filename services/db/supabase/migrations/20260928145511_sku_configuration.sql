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

-- Validate the transport types before the immutable publisher casts values.
-- No ignored fields, generated IDs, implicit rates, or partial period patches.
create function private.validate_sku_configuration_changes(p_changes jsonb, p_change_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
    change_fields constant text[] := array['sku', 'company_id', 'expected_current_version_id', 'periods'];
    period_fields constant text[] := array['marketplace_name', 'valid_from', 'valid_to', 'fee_rate_percent'];
    change jsonb;
    period jsonb;
    start_date date;
    end_date date;
    rate numeric;
begin
    if p_changes is null or jsonb_typeof(p_changes) <> 'array'
        or nullif(btrim(p_change_reason), '') is null then
        raise exception 'Invalid SKU configuration' using errcode = '23514';
    end if;
    if jsonb_array_length(p_changes) = 0 then
        raise exception 'Invalid SKU configuration' using errcode = '23514';
    end if;
    for change in select value from jsonb_array_elements(p_changes) loop
        if jsonb_typeof(change) <> 'object' then
            raise exception 'Invalid SKU configuration' using errcode = '23514';
        end if;
        if not (change ?& change_fields)
            or exists (select 1 from jsonb_object_keys(change) as key(value)
                where value <> all(change_fields))
            or jsonb_typeof(change->'sku') <> 'string'
            or nullif(btrim(change->>'sku'), '') is null
            or jsonb_typeof(change->'company_id') not in ('string', 'null')
            or jsonb_typeof(change->'expected_current_version_id') not in ('string', 'null')
            or jsonb_typeof(change->'periods') <> 'array' then
            raise exception 'Invalid SKU configuration' using errcode = '23514';
        end if;
        perform (change->>'expected_current_version_id')::uuid;
        if change->>'company_id' is not null and not exists (
            select 1 from public.companies as c where c.id = (change->>'company_id')::uuid
        ) then
            raise exception 'Invalid SKU configuration' using errcode = '23514';
        end if;
        for period in select value from jsonb_array_elements(change->'periods') loop
            if jsonb_typeof(period) <> 'object' then
                raise exception 'Invalid SKU configuration' using errcode = '23514';
            end if;
            if not (period ?& period_fields)
                or exists (select 1 from jsonb_object_keys(period) as key(value)
                    where value <> all(period_fields))
                or jsonb_typeof(period->'marketplace_name') <> 'string'
                or jsonb_typeof(period->'valid_from') <> 'string'
                or jsonb_typeof(period->'valid_to') not in ('string', 'null')
                or jsonb_typeof(period->'fee_rate_percent') <> 'string'
                or period->>'valid_from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                or (period->>'valid_to' is not null
                    and period->>'valid_to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
                raise exception 'Invalid SKU configuration' using errcode = '23514';
            end if;
            start_date := (period->>'valid_from')::date;
            end_date := (period->>'valid_to')::date;
            rate := (period->>'fee_rate_percent')::numeric;
            if not isfinite(start_date) or (end_date is not null
                and (not isfinite(end_date) or end_date <= start_date))
                or rate::text in ('NaN', 'Infinity', '-Infinity')
                or rate < 0 or rate > 100 or scale(rate) > 6 then
                raise exception 'Invalid SKU configuration' using errcode = '23514';
            end if;
        end loop;
    end loop;
    if exists (select 1 from jsonb_array_elements(p_changes) as changes(value)
        group by value->>'sku' having count(*) > 1) then
        raise exception 'Invalid SKU configuration' using errcode = '23514';
    end if;
exception
    when invalid_text_representation or numeric_value_out_of_range
        or datetime_field_overflow or invalid_datetime_format then
        raise exception 'Invalid SKU configuration' using errcode = '23514';
end;
$$;

-- CAS is checked for every changed SKU; global validation sees one resulting
-- configuration snapshot after all writes. Later source publications may expose
-- new gaps and do not invalidate this immutable publication retroactively.
create function private.publish_operator_sku_configuration(p_changes jsonb, p_change_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare change jsonb; periods_with_ids jsonb; version_id uuid;
    published jsonb := '[]'::jsonb; configuration jsonb; issues jsonb;
begin
    if not private.is_operator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    perform private.validate_sku_configuration_changes(p_changes, p_change_reason);
    -- Take every lock before writing. Concurrent batches use the same ordering,
    -- and the trusted single-SKU publisher uses the identical lock key.
    for change in select value from jsonb_array_elements(p_changes) order by value->>'sku' collate "C" loop
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'sku-terms', change->>'sku'
        )::text, 0));
    end loop;
    for change in select value from jsonb_array_elements(p_changes) order by value->>'sku' collate "C" loop
        select coalesce(jsonb_agg(value || jsonb_build_object('id', private.uuid7())), '[]'::jsonb)
        into periods_with_ids from jsonb_array_elements(change->'periods');
        begin
            version_id := private.publish_sku_terms(jsonb_build_object(
                'id', private.uuid7(), 'sku_id', private.uuid7(), 'sku', change->>'sku',
                'company_id', change->'company_id',
                'expected_current_version_id', change->'expected_current_version_id',
                'change_reason', p_change_reason, 'periods', periods_with_ids
            ));
        exception
            when serialization_failure then
                raise exception 'SKU configuration changed while editing' using errcode = 'PT409';
            when check_violation or not_null_violation or foreign_key_violation or exclusion_violation then
                raise exception 'Invalid SKU configuration' using errcode = '23514';
        end;
        published := published || jsonb_build_array(jsonb_build_object(
            'sku', change->>'sku', 'terms_version_id', version_id
        ));
    end loop;
    -- Validation must never switch to the member-only read branch if an account
    -- changes while a batch waits. The catalog repeats the administrator gate.
    configuration := private.sku_configuration_items(array(
        select value from jsonb_array_elements_text(public.sku_filter_options()->'values')
    ));
    select coalesce(jsonb_agg(issue order by issue->>'sku' collate "C", issue->>'kind',
        issue->>'marketplace_name' collate "C", issue->>'valid_from'), '[]'::jsonb)
    into issues
    from jsonb_array_elements(configuration->'items') as items(item)
    cross join lateral jsonb_array_elements(item->'issues') as item_issues(issue);
    if jsonb_array_length(issues) > 0 then
        raise exception 'SKU configuration is incomplete' using errcode = '23514',
            detail = jsonb_build_object('issues', issues)::text;
    end if;
    return jsonb_build_object('published', published, 'changed_count', jsonb_array_length(published));
end;
$$;

create function public.publish_sku_configuration(p_changes jsonb, p_change_reason text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.publish_operator_sku_configuration(p_changes, p_change_reason);
$$;

-- Only caller-checked entry points receive application execution privileges.
revoke all on function private.sku_configuration_required_dates(text[]),
private.sku_configuration_items(text[]), private.read_sku_configuration(),
private.validate_sku_configuration_changes(jsonb, text),
private.publish_operator_sku_configuration(jsonb, text), public.sku_configuration(),
public.publish_sku_configuration(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function private.read_sku_configuration(), public.sku_configuration(),
private.publish_operator_sku_configuration(jsonb, text),
public.publish_sku_configuration(jsonb, text)
to authenticated;
notify pgrst, 'reload schema';
