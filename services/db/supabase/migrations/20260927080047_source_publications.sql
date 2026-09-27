-- Publish complete preprocessed source inventories and advance current pointers.
create function private.publish_settlement_preprocess(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition private.settlement_acquisitions; settlement private.settlements;
    metadata private.settlement_preprocess_versions;
    published_version_id public.local_uuid := (p_payload->>'id')::uuid;
begin
    select * into strict acquisition from private.settlement_acquisitions where id = (p_payload->>'acquisition_id')::uuid;
    if jsonb_typeof(p_payload->'transactions') is distinct from 'array' then
        raise exception 'Complete settlement transaction array required' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_payload->'transactions') entry
        where jsonb_typeof(entry) is distinct from 'object'
            or not entry ? 'category') then
        raise exception 'Settlement transactions require category'
            using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'settlement', acquisition.seller_namespace, acquisition.amazon_scope,
        p_payload->>'settlement_id')::text, 0));
    insert into private.settlements(seller_namespace,amazon_scope,settlement_id,document_sha256)
        values (acquisition.seller_namespace,acquisition.amazon_scope,p_payload->>'settlement_id',acquisition.document_sha256)
        on conflict (seller_namespace,amazon_scope,settlement_id) do nothing;
    select * into strict settlement from private.settlements s where
        (s.seller_namespace,s.amazon_scope,s.settlement_id) =
        (acquisition.seller_namespace,acquisition.amazon_scope,p_payload->>'settlement_id') for update;
    if settlement.document_sha256 <> acquisition.document_sha256 then
        raise exception 'Canonical settlement identity has conflicting decoded contents' using errcode = '23514';
    end if;
    if settlement.current_version_id is distinct from (p_payload->>'expected_current_version_id')::uuid then
        raise exception 'Stale settlement publication' using errcode = '40001';
    end if;
    metadata := jsonb_populate_record(null::private.settlement_preprocess_versions,p_payload->'metadata');
    insert into private.settlement_preprocess_versions(id,settlement_id,acquisition_id,preprocess_version,row_count,
        settlement_start_at,settlement_end_at,deposit_at,settlement_start_date,settlement_end_date,total_amount,currency,
        observed_start_date,observed_end_date,source_line_number,diagnostics)
        values (published_version_id,settlement.id,acquisition.id,p_payload->>'preprocess_version',jsonb_array_length(p_payload->'transactions'),
            metadata.settlement_start_at,metadata.settlement_end_at,metadata.deposit_at,metadata.settlement_start_date,metadata.settlement_end_date,
            metadata.total_amount,metadata.currency,metadata.observed_start_date,metadata.observed_end_date,metadata.source_line_number,
            coalesce(p_payload->'diagnostics','[]'::jsonb));
    insert into private.settlement_transactions(id,version_id,seller_namespace,source_line_number,category,family,
        component_type,accounting_subtype,sku,marketplace_name,amount,currency,quantity,posted_date,posted_at,
        transaction_type,amount_type,amount_description,source_fields)
        select t.id,published_version_id,acquisition.seller_namespace,t.source_line_number,t.category,t.family,
            t.component_type,t.accounting_subtype,t.sku,t.marketplace_name,t.amount,t.currency,t.quantity,
            t.posted_date,t.posted_at,t.transaction_type,t.amount_type,t.amount_description,t.source_fields
        from jsonb_populate_recordset(null::private.settlement_transactions,p_payload->'transactions') t;
    if exists (select 1 from private.settlement_transactions t
        where t.version_id = published_version_id and t.currency is distinct from metadata.currency) then
        raise exception 'Settlement currency control mismatch' using errcode = '23514';
    end if;
    if (select coalesce(sum(t.amount),0) from private.settlement_transactions t where t.version_id = published_version_id)
        is distinct from metadata.total_amount then
        raise exception 'Settlement total control mismatch' using errcode = '23514';
    end if;
    update private.settlements set current_version_id = published_version_id where id = settlement.id;
    return published_version_id;
end;
$$;

create function private.publish_data_kiosk_preprocess(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition private.data_kiosk_acquisitions; current_day private.data_kiosk_days;
    day_payload jsonb;
    published_batch_id public.local_uuid := (p_payload->>'id')::uuid; published_version_id public.local_uuid;
    current_acquisition private.data_kiosk_acquisitions; dataset text := coalesce(p_payload->>'dataset_key','economics');
    day_count integer; expected_days integer;
begin
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
        elsif acquisition.id = current_acquisition.id then
            if published_version_id <= current_day.current_version_id then
                raise exception 'Local Data Kiosk version must advance' using errcode = '23514';
            end if;
            update private.data_kiosk_days set current_version_id = published_version_id where id = current_day.id;
        end if;
    end loop;
    return published_batch_id;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
