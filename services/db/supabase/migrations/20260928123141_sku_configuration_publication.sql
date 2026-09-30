-- Publish a complete immutable ownership/fee revision using compare-and-swap.
create function private.publish_sku_terms(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare identity public.skus; published_version_id public.local_uuid := (p_payload->>'id')::uuid;
    next_version_number bigint;
begin
    if jsonb_typeof(p_payload) is distinct from 'object'
        or not (p_payload ?& array['id','sku_id','sku','company_id',
            'expected_current_version_id','change_reason','periods'])
        or jsonb_typeof(p_payload->'periods') is distinct from 'array'
        or jsonb_typeof(p_payload->'sku') is distinct from 'string'
        or jsonb_typeof(p_payload->'change_reason') is distinct from 'string' then
        raise exception 'Explicit owner, expected selection, and complete terms payload required' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'sku-terms',p_payload->>'sku')::text,0));
    insert into public.skus(id,sku)
        values ((p_payload->>'sku_id')::uuid,p_payload->>'sku')
        on conflict (sku) do nothing;
    select * into strict identity from public.skus s
        where s.sku = p_payload->>'sku' for update;
    if identity.current_terms_version_id is distinct from (p_payload->>'expected_current_version_id')::uuid then
        raise exception 'Stale SKU terms publication' using errcode = '40001';
    end if;
    select coalesce(max(v.version_number),0) + 1 into next_version_number
        from public.sku_terms_versions v where v.sku_id = identity.id;
    insert into public.sku_terms_versions(id,sku_id,company_id,version_number,fee_period_count,change_reason)
        values (published_version_id,identity.id,(p_payload->>'company_id')::uuid,next_version_number,
            jsonb_array_length(p_payload->'periods'),p_payload->>'change_reason');
    insert into public.sku_fee_periods(id,terms_version_id,marketplace_name,valid_period,fee_rate_percent)
        select (period_payload->>'id')::uuid,published_version_id,
            period_payload->>'marketplace_name',
            daterange((period_payload->>'valid_from')::date,(period_payload->>'valid_to')::date,'[)'),
            (period_payload->>'fee_rate_percent')::numeric
        from jsonb_array_elements(p_payload->'periods') as periods(period_payload);
    update public.skus set current_terms_version_id = published_version_id where id = identity.id;
    return published_version_id;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

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
