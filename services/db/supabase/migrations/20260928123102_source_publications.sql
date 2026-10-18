-- Publish complete preprocessed source inventories and advance current pointers.
create function private.publish_finances_preprocess(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition private.finances_acquisitions; current_day private.finances_days;
    previous_acquisition private.finances_acquisitions;
    day_payload jsonb; summary_payload jsonb;
    published_version_id uuid; published_batch_id uuid := (p_payload->>'id')::uuid;
    summary_id uuid; actual_amount numeric;
    day_count integer; row_count integer;
    coverage jsonb; changed_months date[] := '{}'; published_versions uuid[] := '{}';
    summary_versions uuid[]; scope_expanded boolean; summary_market_count integer;
begin
    perform private.lock_payout_report_inputs();
    select * into strict acquisition from private.finances_acquisitions where id=(p_payload->>'acquisition_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('finances-native-identity',acquisition.seller_namespace)::text,0));
    if jsonb_typeof(p_payload->'days') is distinct from 'array' or jsonb_typeof(p_payload->'summaries') is distinct from 'array' then
        raise exception 'Complete Finances days and Summary observations required' using errcode='23514';
    end if;
    day_count := jsonb_array_length(p_payload->'days');
    if day_count <> (acquisition.query_end_date-acquisition.query_start_date+1)*cardinality(acquisition.marketplace_ids)
        or (select count(distinct(value->>'marketplace_name',value->>'activity_date')) from jsonb_array_elements(p_payload->'days')) <> day_count then
        raise exception 'Complete Finances marketplace/day coverage required' using errcode='23514';
    end if;
    scope_expanded := exists(select 1 from jsonb_array_elements(p_payload->'days') d
        where not exists(select 1 from private.finances_days old where old.seller_namespace=acquisition.seller_namespace and old.marketplace_name=d->>'marketplace_name'));
    scope_expanded := scope_expanded or private.payout_source_has_new_skus(acquisition.seller_namespace,array(
        select distinct c->>'sku' from jsonb_array_elements(p_payload->'days') d
        cross join lateral jsonb_array_elements(d->'transactions') t
        cross join lateral jsonb_array_elements(t->'components') c));
    insert into private.finances_preprocess_batches(id,acquisition_id,day_count) values(published_batch_id,acquisition.id,day_count);
    for day_payload in select value from jsonb_array_elements(p_payload->'days') order by value->>'marketplace_name',value->>'activity_date' loop
        select value into coverage from jsonb_array_elements(acquisition.api_metadata->'coverage_marketplaces')
            where value->>'marketplace_id'=day_payload->>'marketplace_id' and value->>'marketplace_name'=day_payload->>'marketplace_name';
        if coverage is null or (day_payload->>'activity_date')::date not between acquisition.query_start_date and acquisition.query_end_date
            or jsonb_typeof(day_payload->'transactions') is distinct from 'array'
            or not day_payload ? 'expected_current_version_id' then
            raise exception 'Invalid complete Finances day' using errcode='23514';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('finances',acquisition.seller_namespace,day_payload->>'marketplace_name',day_payload->>'activity_date')::text,0));
        insert into private.finances_days(seller_namespace,marketplace_name,activity_date)
            values(acquisition.seller_namespace,day_payload->>'marketplace_name',(day_payload->>'activity_date')::date)
            on conflict(seller_namespace,marketplace_name,activity_date) do nothing;
        select * into strict current_day from private.finances_days where
            (seller_namespace,marketplace_name,activity_date)=(acquisition.seller_namespace,day_payload->>'marketplace_name',(day_payload->>'activity_date')::date) for update;
        if current_day.current_version_id is distinct from (day_payload->>'expected_current_version_id')::uuid then
            raise exception 'Stale Finances day publication' using errcode='40001';
        end if;
        if exists(select 1 from jsonb_array_elements(day_payload->'transactions') t where jsonb_typeof(t->'components') is distinct from 'array') then
            raise exception 'Complete native Finances component inventory required' using errcode='23514';
        end if;
        select coalesce(sum(jsonb_array_length(t->'components')),0)::integer into row_count from jsonb_array_elements(day_payload->'transactions') t;
        published_version_id := (day_payload->>'id')::uuid;
        insert into private.finances_preprocess_versions(id,day_id,batch_id,preprocess_version,transaction_count,row_count,content_sha256,diagnostics)
            values(published_version_id,current_day.id,published_batch_id,p_payload->>'preprocess_version',jsonb_array_length(day_payload->'transactions'),row_count,day_payload->>'content_sha256',coalesce(day_payload->'diagnostics','[]'));
        if exists(select 1 from jsonb_populate_recordset(null::private.finances_transactions,day_payload->'transactions') t
            where (t.posted_at at time zone (coverage->>'time_zone'))::date is distinct from current_day.activity_date) then
            raise exception 'Finances native scope or lifecycle eligibility is invalid' using errcode='23514';
        end if;
        insert into private.finances_transactions(id,version_id,seller_namespace,native_transaction_id,marketplace_name,marketplace_id,
            account_type,transaction_type,transaction_status,posted_date,posted_at,deferred_transaction_id,release_transaction_id,
            total_amount,currency,activity_eligible,source_page_number,source_record_number,component_count,source_fields)
        select t.id,published_version_id,acquisition.seller_namespace,t.native_transaction_id,current_day.marketplace_name,day_payload->>'marketplace_id',
            t.account_type,t.transaction_type,t.transaction_status,current_day.activity_date,t.posted_at,
            t.deferred_transaction_id,t.release_transaction_id,t.total_amount,t.currency,t.activity_eligible,
            t.source_page_number,t.source_record_number,jsonb_array_length(item->'components'),t.source_fields
        from jsonb_array_elements(day_payload->'transactions') item
        cross join lateral jsonb_populate_record(null::private.finances_transactions,item) t;
        insert into private.finances_transaction_components(id,version_id,transaction_id,native_transaction_id,deferred_transaction_id,release_transaction_id,
            seller_namespace,source_page_number,source_record_number,component_key,category,component_type,accounting_subtype,sku,marketplace_name,amount,currency,quantity,fee_base,
            posted_date,posted_at,transaction_type,transaction_status,account_type,activity_eligible,breakdown_path,source_fields)
        select c.id,published_version_id,t.id,t.native_transaction_id,t.deferred_transaction_id,t.release_transaction_id,
            acquisition.seller_namespace,t.source_page_number,t.source_record_number,
            c.component_key,c.category,c.component_type,c.accounting_subtype,c.sku,current_day.marketplace_name,
            c.amount,c.currency,c.quantity,c.fee_base,current_day.activity_date,t.posted_at,t.transaction_type,t.transaction_status,
            t.account_type,t.activity_eligible,coalesce(c.source_fields->'breakdown_path','[]'::jsonb),c.source_fields
        from jsonb_array_elements(day_payload->'transactions') parents(item)
        cross join lateral jsonb_populate_record(null::private.finances_transactions,parents.item) t
        cross join lateral jsonb_array_elements(parents.item->'components') children(item)
        cross join lateral jsonb_populate_record(null::private.finances_transaction_components,children.item) c;
        if exists(select 1 from private.finances_transactions t
            left join lateral(select sum(c.amount) amount,bool_or(c.currency<>t.currency) invalid_currency
                from private.finances_transaction_components c where c.transaction_id=t.id) partition on true
            where t.version_id=published_version_id and (coalesce(partition.amount,0)<>t.total_amount or partition.invalid_currency)) then
            raise exception 'Finances component partition differs from native total or currency' using errcode='23514';
        end if;
        select a.* into previous_acquisition from private.finances_preprocess_versions v join private.finances_preprocess_batches b on b.id=v.batch_id
            join private.finances_acquisitions a on a.id=b.acquisition_id where v.id=current_day.current_version_id;
        if current_day.current_version_id is null or (acquisition.capture_started_at,acquisition.id) > (previous_acquisition.capture_started_at,previous_acquisition.id)
            or acquisition.id=previous_acquisition.id then
            if acquisition.id=previous_acquisition.id and published_version_id <= current_day.current_version_id then
                raise exception 'Local Finances version must advance' using errcode='23514';
            end if;
            update private.finances_days set current_version_id=published_version_id where id=current_day.id;
            changed_months := array_append(changed_months,date_trunc('month',current_day.activity_date)::date);
        end if;
        published_versions := array_append(published_versions,published_version_id);
    end loop;
    if exists(select 1 from private.finances_transactions t where t.version_id=any(published_versions)
        and t.activity_eligible is distinct from private.finances_activity_eligible(
            t.transaction_type,t.deferred_transaction_id,t.native_transaction_id,published_batch_id)) then
        raise exception 'Finances activity eligibility must follow native lifecycle identifiers in its capture' using errcode='23514';
    end if;
    if exists(select 1 from private.finances_transactions t
        join private.finances_transactions other on other.seller_namespace=t.seller_namespace
            and other.native_transaction_id=t.native_transaction_id and other.id<>t.id
        join private.finances_days d on d.current_version_id=other.version_id
        join private.finances_days selected on selected.current_version_id=t.version_id
        where t.version_id=any(published_versions)) then
        raise exception 'Native transaction has conflicting current day locations; refresh affected days together' using errcode='23514';
    end if;
    if (select count(distinct (s->>'marketplace_name',s->>'account_type',s->>'currency',s->>'period_start',s->>'period_end')) from jsonb_array_elements(p_payload->'summaries') s) <> jsonb_array_length(p_payload->'summaries') then
        raise exception 'Summary control scopes must be unique' using errcode='23514';
    end if;
    for summary_payload in select value from jsonb_array_elements(p_payload->'summaries') loop
        if (summary_payload->>'period_start')::date < acquisition.query_start_date or (summary_payload->>'period_end')::date > acquisition.query_end_date
            or (summary_payload->>'period_end')::date < (summary_payload->>'period_start')::date
            or not exists(select 1 from jsonb_array_elements(acquisition.api_metadata->'coverage_marketplaces') m where m->>'marketplace_name'=summary_payload->>'marketplace_name' and m->>'marketplace_id'=summary_payload->>'marketplace_id')
            or not exists(select 1 from jsonb_array_elements(acquisition.documents) p where p->>'operation'='summary'
                and p->>'marketplace_id' is null and (p->>'page_number')::integer=(summary_payload->>'source_page_number')::integer) then
            raise exception 'Summary control requires matching archived response and covered dates' using errcode='23514';
        end if;
        select array_agg(v.id order by d.activity_date) into summary_versions from private.finances_preprocess_versions v join private.finances_days d on d.id=v.day_id
            where v.id=any(published_versions) and private.finances_summary_marketplace(d.marketplace_name)=summary_payload->>'marketplace_name'
                and d.activity_date between (summary_payload->>'period_start')::date and (summary_payload->>'period_end')::date;
        select count(*)::integer into summary_market_count from jsonb_array_elements(acquisition.api_metadata->'coverage_marketplaces') m
            where private.finances_summary_marketplace(m->>'marketplace_name')=summary_payload->>'marketplace_name';
        if cardinality(summary_versions) is distinct from (((summary_payload->>'period_end')::date-(summary_payload->>'period_start')::date+1)*summary_market_count) then
            raise exception 'Summary control requires a complete day-version manifest' using errcode='23514';
        end if;
        select coalesce(sum(t.total_amount),0) into actual_amount from private.finances_transactions t where t.version_id=any(summary_versions)
            and t.activity_eligible and t.account_type=summary_payload->>'account_type' and t.currency=summary_payload->>'currency';
        summary_id := private.uuid7();
        insert into private.finances_summary_checks(id,seller_namespace,marketplace_name,start_date,end_date,account_type,currency,summary_amount,transaction_amount,
            acquisition_id,source_page_number,source_summary_index,version_count)
        values(summary_id,acquisition.seller_namespace,summary_payload->>'marketplace_name',(summary_payload->>'period_start')::date,(summary_payload->>'period_end')::date,
            summary_payload->>'account_type',summary_payload->>'currency',(summary_payload->>'net_proceeds')::numeric,actual_amount,
            acquisition.id,(summary_payload->>'source_page_number')::integer,(summary_payload->>'source_summary_index')::integer,cardinality(summary_versions));
        insert into private.finances_summary_check_versions(check_id,day_id,version_id)
            select summary_id,v.day_id,v.id from private.finances_preprocess_versions v where v.id=any(summary_versions);
    end loop;
    perform private.request_payout_report_refresh(changed_months);
    if scope_expanded then perform private.request_all_payout_report_refreshes(); end if;
    return published_batch_id;
end;
$$;

create function private.publish_data_kiosk_preprocess(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition private.data_kiosk_acquisitions; current_day private.data_kiosk_days;
    day_payload jsonb;
    published_batch_id public.local_uuid := (p_payload->>'id')::uuid; published_version_id public.local_uuid;
    current_acquisition private.data_kiosk_acquisitions; dataset text := coalesce(p_payload->>'dataset_key','economics');
    day_count integer; expected_days integer;
    scope_expanded boolean; changed_months date[] := '{}';
begin
    perform private.lock_payout_report_inputs();
    select * into strict acquisition from private.data_kiosk_acquisitions where id = (p_payload->>'acquisition_id')::uuid;
    if jsonb_typeof(p_payload->'days') is distinct from 'array' then
        raise exception 'Complete covered days array required' using errcode = '23514';
    end if;
    day_count := jsonb_array_length(p_payload->'days');
    expected_days := (acquisition.query_end_date - acquisition.query_start_date + 1) * cardinality(acquisition.marketplace_ids);
    if dataset <> 'economics' or day_count <> expected_days
        or (select count(distinct value->>'marketplace_name') from jsonb_array_elements(p_payload->'days')) <> 1
        or (
        select count(distinct (value->>'marketplace_name',value->>'activity_date')) from jsonb_array_elements(p_payload->'days')
    ) <> day_count then
        raise exception 'Complete economics marketplace/day coverage required' using errcode = '23514';
    end if;
    scope_expanded := private.payout_source_has_new_skus(acquisition.seller_namespace,array(
        select distinct entry->>'sku'
        from jsonb_array_elements(p_payload->'days') day
        cross join lateral jsonb_array_elements(case
            when jsonb_typeof(day->'transactions') = 'array' then day->'transactions'
            else '[]'::jsonb end) entry
    )) or exists (
        select 1 from jsonb_array_elements(p_payload->'days') day
        where not exists (select 1 from private.data_kiosk_days d
            where d.seller_namespace = acquisition.seller_namespace
                and d.marketplace_name = day->>'marketplace_name' and d.dataset_key = dataset)
    );
    -- Publication and retention both acquire day row locks in natural identity
    -- order: seller, marketplace text, activity date, dataset. UUID creation order
    -- can differ from date order when older days are discovered later.
    for day_payload in select value from jsonb_array_elements(p_payload->'days')
        order by value->>'marketplace_name',value->>'activity_date'
    loop
        if (day_payload->>'activity_date')::date not between acquisition.query_start_date and acquisition.query_end_date
            or jsonb_typeof(day_payload->'transactions') is distinct from 'array' then
            raise exception 'Invalid covered day' using errcode = '23514';
        end if;
        if exists (select 1 from jsonb_array_elements(day_payload->'transactions') entry
            where jsonb_typeof(entry) is distinct from 'object'
                or not entry ? 'category') then
            raise exception 'Data Kiosk transactions require category'
                using errcode = '23514';
        end if;
        -- The persisted marketplace comes from the day. Still validate an optional
        -- transaction value rather than accepting an unsupported ignored field.
        if exists (select 1 from jsonb_array_elements(day_payload->'transactions') entry
            where entry->>'marketplace_name' is not null
                and entry->>'marketplace_name' not in (
                    'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
                    'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
                    'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
                    'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
                    'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
                )) then
            raise exception 'Unsupported Data Kiosk transaction marketplace'
                using errcode = '23514';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'data-kiosk', acquisition.seller_namespace, day_payload->>'marketplace_name',
            day_payload->>'activity_date', dataset)::text, 0));
        insert into private.data_kiosk_days(seller_namespace,marketplace_name,activity_date,dataset_key)
            values (acquisition.seller_namespace,day_payload->>'marketplace_name',
                (day_payload->>'activity_date')::date,dataset)
            on conflict (seller_namespace,marketplace_name,activity_date,dataset_key) do nothing;
    end loop;
    insert into private.data_kiosk_preprocess_batches(id,acquisition_id,day_count) values (published_batch_id,acquisition.id,day_count);
    for day_payload in select value from jsonb_array_elements(p_payload->'days')
        order by value->>'marketplace_name',value->>'activity_date'
    loop
        select * into strict current_day from private.data_kiosk_days d where
            (d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key) =
            (acquisition.seller_namespace,day_payload->>'marketplace_name',
                (day_payload->>'activity_date')::date,dataset) for update;
        if current_day.current_version_id is distinct from (day_payload->>'expected_current_version_id')::uuid then
            raise exception 'Stale Data Kiosk day publication' using errcode = '40001';
        end if;
        published_version_id := (day_payload->>'id')::uuid;
        insert into private.data_kiosk_preprocess_versions(id,day_id,batch_id,preprocess_version,row_count,content_sha256)
            values (published_version_id,current_day.id,published_batch_id,p_payload->>'preprocess_version',
                jsonb_array_length(day_payload->'transactions'),day_payload->>'content_sha256');
        insert into private.data_kiosk_transactions(id,version_id,seller_namespace,marketplace_name,activity_date,
            component_key,sku,category,component_type,amount,currency,quantity,fee_base,
            native_dimensions,source_document_id,source_line_number)
            select t.id,published_version_id,acquisition.seller_namespace,current_day.marketplace_name,current_day.activity_date,
                t.component_key,t.sku,t.category,t.component_type,t.amount,t.currency,t.quantity,
                t.fee_base,t.native_dimensions,t.source_document_id,t.source_line_number
            from jsonb_populate_recordset(null::private.data_kiosk_transactions,day_payload->'transactions') t;
        select a.* into current_acquisition from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.id = current_day.current_version_id;
        if current_day.current_version_id is null or (acquisition.root_query_created_at,acquisition.id) >
            (current_acquisition.root_query_created_at,current_acquisition.id) then
            update private.data_kiosk_days set current_version_id = published_version_id where id = current_day.id;
            changed_months := array_append(changed_months,date_trunc('month',current_day.activity_date)::date);
        elsif acquisition.id = current_acquisition.id then
            if published_version_id <= current_day.current_version_id then
                raise exception 'Local Data Kiosk version must advance' using errcode = '23514';
            end if;
            update private.data_kiosk_days set current_version_id = published_version_id where id = current_day.id;
            changed_months := array_append(changed_months,date_trunc('month',current_day.activity_date)::date);
        end if;
    end loop;
    perform private.request_payout_report_refresh(changed_months);
    if scope_expanded then
        perform private.request_all_payout_report_refreshes();
    end if;
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
