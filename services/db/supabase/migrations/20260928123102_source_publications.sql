-- Finances publication is performed by the Python preprocessor in one transaction.
-- Data Kiosk retains its complete-day publication workflow.
create function private.publish_data_kiosk_preprocess(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition private.data_kiosk_acquisitions; current_day private.data_kiosk_days;
    day_payload jsonb; published_batch_id public.local_uuid := (p_payload->>'id')::uuid;
    published_version_id public.local_uuid; current_acquisition_id public.local_uuid;
    current_query_created_at timestamptz; dataset text := p_payload->>'dataset_key';
    day_count integer; expected_days integer; scope_expanded boolean; changed_months date[] := '{}';
begin
    perform private.lock_payout_report_inputs();
    perform private.require_read_committed();
    select * into strict acquisition from private.data_kiosk_acquisitions where id = (p_payload->>'acquisition_id')::uuid;
    if jsonb_typeof(p_payload->'days') is distinct from 'array' then
        raise exception 'Complete covered days array required' using errcode = '23514';
    end if;
    day_count := jsonb_array_length(p_payload->'days');
    expected_days := (acquisition.query_end_date - acquisition.query_start_date + 1) * cardinality(acquisition.marketplace_ids);
    if dataset is distinct from 'economics' or day_count <> expected_days
        or (select count(distinct value->>'marketplace_name') from jsonb_array_elements(p_payload->'days')) <> 1
        or (select count(distinct (value->>'marketplace_name',value->>'activity_date'))
            from jsonb_array_elements(p_payload->'days')) <> day_count then
        raise exception 'Complete economics marketplace/day coverage required' using errcode = '23514';
    end if;
    scope_expanded := private.payout_source_has_new_skus(acquisition.seller_namespace,array(
        select distinct entry->>'sku' from jsonb_array_elements(p_payload->'days') day
        cross join lateral jsonb_array_elements(case when jsonb_typeof(day->'transactions') = 'array'
            then day->'transactions' else '[]'::jsonb end) entry
    )) or exists (
        select 1 from jsonb_array_elements(p_payload->'days') day
        where not exists (select 1 from private.data_kiosk_days d
            where d.seller_namespace = acquisition.seller_namespace
                and d.marketplace_name = day->>'marketplace_name' and d.dataset_key = dataset)
    );
    insert into private.data_kiosk_preprocess_batches(id,acquisition_id,preprocess_version,day_count)
        values (published_batch_id,acquisition.id,p_payload->>'preprocess_version',day_count);
    -- Publish each complete day under the same ordered identity locks.
    for day_payload in select value from jsonb_array_elements(p_payload->'days')
        order by value->>'marketplace_name',value->>'activity_date'
    loop
        if (day_payload->>'activity_date')::date not between acquisition.query_start_date and acquisition.query_end_date
            or jsonb_typeof(day_payload->'transactions') is distinct from 'array' then
            raise exception 'Invalid covered day' using errcode = '23514';
        end if;
        if exists (select 1 from jsonb_array_elements(day_payload->'transactions') entry
            where jsonb_typeof(entry) is distinct from 'object' or not entry ? 'category') then
            raise exception 'Data Kiosk transactions require category' using errcode = '23514';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'data-kiosk', acquisition.seller_namespace, day_payload->>'marketplace_name',
            day_payload->>'activity_date', dataset)::text, 0));
        insert into private.data_kiosk_days(seller_namespace,marketplace_name,activity_date,dataset_key)
            values (acquisition.seller_namespace,day_payload->>'marketplace_name',
                (day_payload->>'activity_date')::date,dataset)
            on conflict (seller_namespace,marketplace_name,activity_date,dataset_key) do nothing;
        select * into strict current_day from private.data_kiosk_days d where
            (d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key) =
            (acquisition.seller_namespace,day_payload->>'marketplace_name',
                (day_payload->>'activity_date')::date,dataset) for update;
        if current_day.current_version_id is distinct from (day_payload->>'expected_current_version_id')::uuid
            or current_day.current_batch_id is distinct from (day_payload->>'expected_current_batch_id')::uuid then
            raise exception 'Stale Data Kiosk day publication' using errcode = '40001';
        end if;
        select v.id into published_version_id from private.data_kiosk_day_versions v
            where v.day_id=current_day.id and v.content_sha256=day_payload->>'content_sha256';
        if published_version_id is null then
            published_version_id := (day_payload->>'id')::uuid;
            insert into private.data_kiosk_day_versions(id,day_id,activity_at,row_count,content_sha256)
                values (published_version_id,current_day.id,(day_payload->>'activity_at')::timestamptz,
                    jsonb_array_length(day_payload->'transactions'),day_payload->>'content_sha256');
            insert into private.data_kiosk_day_components(id,version_id,component_key,sku,category,
                component_type,amount,currency,quantity,fee_base)
                select t.id,published_version_id,t.component_key,t.sku,t.category,
                    t.component_type,t.amount,t.currency,t.quantity,t.fee_base
                from jsonb_populate_recordset(null::private.data_kiosk_day_components,day_payload->'transactions') t;
        end if;
        insert into private.data_kiosk_preprocess_batch_days(batch_id,day_id,version_id)
            values (published_batch_id,current_day.id,published_version_id);
        select a.root_query_created_at,a.id into current_query_created_at,current_acquisition_id
            from private.data_kiosk_preprocess_batches b
            join private.data_kiosk_acquisitions a on a.id=b.acquisition_id
            where b.id=current_day.current_batch_id;
        if current_day.current_version_id is null
            or (acquisition.root_query_created_at,acquisition.id,published_batch_id)
                > (current_query_created_at,current_acquisition_id,current_day.current_batch_id) then
            update private.data_kiosk_days set current_version_id=published_version_id,
                current_batch_id=published_batch_id where id=current_day.id;
            changed_months := array_append(changed_months,date_trunc('month',current_day.activity_date)::date);
        end if;
    end loop;
    perform private.request_payout_report_refresh(changed_months);
    if scope_expanded then perform private.request_all_payout_report_refreshes(); end if;
    return published_batch_id;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

create function private.publish_inventory_capture(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare candidate private.inventory_daily_captures; existing private.inventory_daily_captures;
    source_input private.inventory_acquisitions; previous_input private.inventory_acquisitions;
begin
    if jsonb_typeof(p_payload) is distinct from 'object'
        or not p_payload ?& array['id','seller_namespace','marketplace_name','capture_date',
            'acquisition_id','preprocess_version','row_count','diagnostics',
            'expected_current_capture_id','items']
        or jsonb_typeof(p_payload->'items') is distinct from 'array'
        or jsonb_typeof(p_payload->'diagnostics') is distinct from 'array'
        or jsonb_typeof(p_payload->'expected_current_capture_id') not in ('string', 'null') then
        raise exception 'Complete inventory capture payload and expected reference required' using errcode = '23514';
    end if;
    candidate := jsonb_populate_record(null::private.inventory_daily_captures, p_payload);
    if candidate.row_count is distinct from jsonb_array_length(p_payload->'items') then
        raise exception 'Inventory row count differs from complete item inventory' using errcode = '23514';
    end if;
    select * into source_input from private.inventory_acquisitions where id = candidate.acquisition_id;
    if not found or (candidate.seller_namespace, candidate.marketplace_name, candidate.capture_date)
        is distinct from (source_input.seller_namespace, source_input.marketplace_name, source_input.capture_date) then
        raise exception 'Inventory capture must match its acquisition scope and original date' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'inventory-capture', candidate.seller_namespace, candidate.marketplace_name,
        candidate.capture_date - date '2000-01-01'
    )::text, 0));
    select * into existing from private.inventory_daily_captures
    where seller_namespace = candidate.seller_namespace and marketplace_name = candidate.marketplace_name
        and capture_date = candidate.capture_date for update;
    -- An uncertain successful commit can be retried without creating a new capture.
    if existing.acquisition_id = candidate.acquisition_id
        and existing.preprocess_version = candidate.preprocess_version then
        return existing.id;
    end if;
    if existing.id is distinct from (p_payload->>'expected_current_capture_id')::uuid then
        raise exception 'Stale inventory capture publication' using errcode = '40001';
    end if;
    if existing.id is not null then
        if candidate.id = existing.id then
            raise exception 'Inventory replacement requires a fresh capture ID' using errcode = '23514';
        end if;
        select * into strict previous_input from private.inventory_acquisitions
        where id = existing.acquisition_id;
        if (source_input.report_created_at, source_input.id)
            < (previous_input.report_created_at, previous_input.id) then
            raise exception 'An older inventory observation cannot replace newer data' using errcode = '23514';
        end if;
        delete from private.inventory_daily_captures where id = existing.id;
    end if;
    insert into private.inventory_daily_captures (
        id, seller_namespace, marketplace_name, capture_date, acquisition_id,
        preprocess_version, row_count, diagnostics
    ) values (
        candidate.id, candidate.seller_namespace, candidate.marketplace_name, candidate.capture_date,
        candidate.acquisition_id, candidate.preprocess_version, candidate.row_count, candidate.diagnostics
    );
    insert into private.inventory_items (
        capture_id, sku, source_line_number, snapshot_date, available_quantity, fba_supply_quantity,
        inbound_quantity, inbound_working_quantity, inbound_shipped_quantity, inbound_received_quantity,
        reserved_quantity, reserved_transfer_quantity, reserved_processing_quantity,
        reserved_customer_order_quantity, unfulfillable_quantity, sales_amount_90d, units_shipped_90d,
        currency, health_status, minimum_inventory_units, days_of_supply, total_days_of_supply,
        recommended_ship_in_units, recommended_ship_in_date, recommended_action
    ) select candidate.id, item.sku, item.source_line_number, item.snapshot_date,
        item.available_quantity, item.fba_supply_quantity, item.inbound_quantity,
        item.inbound_working_quantity, item.inbound_shipped_quantity, item.inbound_received_quantity,
        item.reserved_quantity, item.reserved_transfer_quantity, item.reserved_processing_quantity,
        item.reserved_customer_order_quantity, item.unfulfillable_quantity, item.sales_amount_90d,
        item.units_shipped_90d, item.currency, item.health_status, item.minimum_inventory_units,
        item.days_of_supply, item.total_days_of_supply, item.recommended_ship_in_units,
        item.recommended_ship_in_date, item.recommended_action
    from jsonb_populate_recordset(null::private.inventory_items, p_payload->'items') as item;
    return candidate.id;
end;
$$;
