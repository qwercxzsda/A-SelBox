-- Payload IDs are generated immediately before publication by the Python repository.
-- Every function is invoker-only and unavailable to application API roles.
create function private.assert_archive_document(p_document jsonb) returns void
language plpgsql set search_path = '' as $$
declare field_name text;
begin
    if jsonb_typeof(p_document) is distinct from 'object'
        or not p_document ?& array['bucket','object_path','document_sha256','document_byte_length',
            'archive_sha256','archive_byte_length','archive_codec','archive_preset','archive_check',
            'source_compression'] then
        raise exception 'Incomplete immutable XZ archive manifest' using errcode = '23514';
    end if;
    foreach field_name in array array['bucket','object_path','document_sha256','archive_sha256',
        'archive_codec','archive_preset','archive_check'] loop
        if jsonb_typeof(p_document->field_name) is distinct from 'string'
            or btrim(p_document->>field_name) = '' then
            raise exception 'Archive manifest text must be present and nonnull' using errcode = '23514';
        end if;
    end loop;
    foreach field_name in array array['document_byte_length','archive_byte_length'] loop
        if jsonb_typeof(p_document->field_name) is distinct from 'number'
            or p_document->>field_name !~ '^(0|[1-9][0-9]*)$'
            or (p_document->>field_name)::numeric > 9223372036854775807 then
            raise exception 'Archive manifest byte lengths must be exact nonnegative integers' using errcode = '23514';
        end if;
    end loop;
    if p_document->>'bucket' is distinct from 'source-archives'
        or p_document->>'object_path' !~ '^[A-Za-z0-9_/-]+[.]xz$'
        or string_to_array(p_document->>'object_path','/') && array['','.','..']
        or p_document->>'archive_codec' is distinct from 'xz'
        or p_document->>'archive_preset' is distinct from '2e'
        or p_document->>'archive_check' is distinct from 'CRC64'
        or p_document->>'document_sha256' !~ '^[0-9a-f]{64}$'
        or p_document->>'archive_sha256' !~ '^[0-9a-f]{64}$'
        or (p_document->>'archive_byte_length')::bigint <= 0
        or p_document->'source_compression' not in ('null'::jsonb, '"GZIP"'::jsonb) then
        raise exception 'Invalid immutable XZ archive manifest' using errcode = '23514';
    end if;
end;
$$;

create function private.publish_settlement_acquisition(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition_payload private.settlement_acquisitions;
begin
    acquisition_payload := jsonb_populate_record(null::private.settlement_acquisitions, p_payload);
    perform private.assert_archive_document(acquisition_payload.document);
    if acquisition_payload.document_sha256 is distinct from acquisition_payload.document->>'document_sha256' then
        raise exception 'Acquisition document digest mismatch' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
        jsonb_build_array('settlement-download', acquisition_payload.seller_namespace,
            acquisition_payload.amazon_scope, acquisition_payload.report_document_id)::text, 0));
    if exists (select 1 from private.settlement_acquisitions a
        where (a.seller_namespace, a.amazon_scope, a.report_document_id) =
              (acquisition_payload.seller_namespace, acquisition_payload.amazon_scope, acquisition_payload.report_document_id)
          and a.document_sha256 <> acquisition_payload.document_sha256) then
        raise exception 'Known settlement document changed decoded bytes' using errcode = '23514';
    end if;
    insert into private.settlement_acquisitions (
        id, seller_namespace, amazon_scope, report_id, report_document_id, report_type,
        report_created_at, marketplace_ids, api_metadata, downloaded_at, document_sha256, document
    ) values (acquisition_payload.id, acquisition_payload.seller_namespace, acquisition_payload.amazon_scope, acquisition_payload.report_id, acquisition_payload.report_document_id,
        acquisition_payload.report_type, acquisition_payload.report_created_at, acquisition_payload.marketplace_ids, acquisition_payload.api_metadata, acquisition_payload.downloaded_at,
        acquisition_payload.document_sha256, acquisition_payload.document);
    return acquisition_payload.id;
end;
$$;

create function private.publish_data_kiosk_acquisition(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare acquisition_payload private.data_kiosk_acquisitions; page jsonb; metadata jsonb;
    page_index integer := 1; document_count integer := 0; next_token text;
    existing private.data_kiosk_acquisitions;
begin
    acquisition_payload := jsonb_populate_record(null::private.data_kiosk_acquisitions, p_payload);
    if jsonb_typeof(acquisition_payload.documents) is distinct from 'array' or jsonb_array_length(acquisition_payload.documents) = 0 then
        raise exception 'Complete ordered document inventory required' using errcode = '23514';
    end if;
    if acquisition_payload.api_metadata is distinct from acquisition_payload.documents->0->'api_metadata'
        or cardinality(acquisition_payload.marketplace_ids) is distinct from 1 then
        raise exception 'Root query provenance and single marketplace coverage must match the inventory' using errcode = '23514';
    end if;
    for page in select value from jsonb_array_elements(acquisition_payload.documents) loop
        metadata := page->'api_metadata';
        if jsonb_typeof(page) is distinct from 'object'
            or not page ?& array['page_number','query_id','query_created_at','document_kind',
                'is_terminal','document_id','document','api_metadata']
            or jsonb_typeof(page->'page_number') is distinct from 'number'
            or page->>'page_number' !~ '^[1-9][0-9]*$'
            or jsonb_typeof(page->'is_terminal') is distinct from 'boolean'
            or jsonb_typeof(page->'query_id') is distinct from 'string'
            or jsonb_typeof(page->'query_created_at') is distinct from 'string'
            or jsonb_typeof(page->'document_kind') is distinct from 'string'
            or jsonb_typeof(metadata) is distinct from 'object'
            or jsonb_typeof(metadata->'createdTime') is distinct from 'string'
            or jsonb_typeof(metadata->'queryId') is distinct from 'string'
            or jsonb_typeof(metadata->'query') is distinct from 'string' then
            raise exception 'Missing or invalid Data Kiosk page metadata' using errcode = '23514';
        end if;
        if (page->>'page_number')::integer is distinct from page_index
            or btrim(page->>'query_id') = ''
            or page->>'query_id' <> btrim(page->>'query_id')
            or metadata->>'queryId' is distinct from page->>'query_id'
            or (metadata->>'createdTime')::timestamptz is distinct from (page->>'query_created_at')::timestamptz
            or coalesce(metadata->>'processingStatus','') <> 'DONE'
            or btrim(metadata->>'query') = ''
            or page->>'document_kind' not in ('DATA','NO_DATA')
            or coalesce(metadata->>'errorDocumentId','') <> ''
            or (page->>'is_terminal')::boolean is distinct from (page_index = jsonb_array_length(acquisition_payload.documents))
            or (page_index = 1 and (page->>'query_id' is distinct from acquisition_payload.root_query_id
                or (page->>'query_created_at')::timestamptz is distinct from acquisition_payload.root_query_created_at)) then
            raise exception 'Incomplete or inconsistent Data Kiosk page inventory' using errcode = '23514';
        end if;
        if metadata ? 'pagination' and metadata->'pagination' <> 'null'::jsonb
            and jsonb_typeof(metadata->'pagination') is distinct from 'object' then
            raise exception 'Invalid Data Kiosk pagination metadata' using errcode = '23514';
        end if;
        next_token := metadata->'pagination'->>'nextToken';
        if (next_token is null) is distinct from (page->>'is_terminal')::boolean
            or (next_token is not null and (btrim(next_token) = '' or btrim(next_token) <> next_token)) then
            raise exception 'Pagination metadata must establish complete traversal' using errcode = '23514';
        end if;
        if page->>'document_kind' = 'DATA' then
            perform private.assert_archive_document(page->'document');
            if jsonb_typeof(page->'document_id') is distinct from 'string'
                or btrim(page->>'document_id') = ''
                or page->>'document_id' <> btrim(page->>'document_id')
                or metadata->>'dataDocumentId' is distinct from page->>'document_id' then
                raise exception 'Data page document identity required' using errcode = '23514';
            end if;
            document_count := document_count + 1;
        elsif page->'document_id' is distinct from 'null'::jsonb
            or page->'document' is distinct from 'null'::jsonb
            or coalesce(metadata->>'dataDocumentId','') <> '' then
            raise exception 'NO_DATA must be a verified successful empty page' using errcode = '23514';
        end if;
        page_index := page_index + 1;
    end loop;
    if (select count(distinct value->>'query_id') from jsonb_array_elements(acquisition_payload.documents)) <> page_index - 1 then
        raise exception 'Duplicate Data Kiosk page query identity' using errcode = '23514';
    end if;
    if (select count(distinct value->>'document_id') from jsonb_array_elements(acquisition_payload.documents)) <> document_count then
        raise exception 'Duplicate Data Kiosk document identity' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
        jsonb_build_array('data-kiosk-download', acquisition_payload.seller_namespace,
            acquisition_payload.amazon_scope, acquisition_payload.root_query_id)::text, 0));
    select * into existing from private.data_kiosk_acquisitions a
        where (a.seller_namespace,a.amazon_scope,a.root_query_id) = (acquisition_payload.seller_namespace,acquisition_payload.amazon_scope,acquisition_payload.root_query_id);
    if found then
        if (to_jsonb(existing) - array['id','created_at','downloaded_at']) is distinct from
           (to_jsonb(acquisition_payload) - array['id','created_at','downloaded_at']) then
            raise exception 'Data Kiosk observation identity conflict' using errcode = '23514';
        end if;
        return existing.id;
    end if;
    insert into private.data_kiosk_acquisitions (
        id,seller_namespace,amazon_scope,root_query_id,root_query_created_at,schema_version,
        query_definition,marketplace_ids,query_start_date,query_end_date,api_metadata,downloaded_at,documents
    ) values (acquisition_payload.id,acquisition_payload.seller_namespace,acquisition_payload.amazon_scope,acquisition_payload.root_query_id,acquisition_payload.root_query_created_at,acquisition_payload.schema_version,
        acquisition_payload.query_definition,acquisition_payload.marketplace_ids,acquisition_payload.query_start_date,acquisition_payload.query_end_date,acquisition_payload.api_metadata,acquisition_payload.downloaded_at,acquisition_payload.documents);
    return acquisition_payload.id;
end;
$$;

-- Count each affected parent once per INSERT statement, not once per child row.
-- Publishers insert each complete child set in one statement. Deferred parent
-- checks still reject incomplete transactions; immutable rows never reopen slots.
create function private.guard_child_inventory() returns trigger language plpgsql
set search_path = '' as $$
declare expected integer; actual bigint; parent_id uuid;
begin
    for parent_id in execute format('select distinct %I from inserted_children order by %I', tg_argv[2], tg_argv[2]) loop
        -- Compatible with the inserted children's FK key-share locks, while
        -- serializing inventory guards that address the same parent.
        execute format('select %I from %s where id = $1 for no key update', tg_argv[1], tg_argv[0])
            into expected using parent_id;
        if expected is null then raise exception 'Missing version parent' using errcode = '23503'; end if;
        execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, tg_argv[2])
            into actual using parent_id;
        if actual > expected or (tg_table_name = 'data_kiosk_transactions' and exists (
            select 1 from private.data_kiosk_pruned_versions where version_id = parent_id
        )) then
            raise exception 'Published child inventory is frozen' using errcode = '23514';
        end if;
    end loop;
    return null;
end;
$$;
create function private.check_complete_inventory() returns trigger language plpgsql
set search_path = '' as $$
declare expected integer; actual integer; parent_id uuid;
begin
    parent_id := (to_jsonb(new)->>'id')::uuid;
    expected := (to_jsonb(new)->>tg_argv[1])::integer;
    execute format('select count(*) from %s where %I = $1', tg_argv[0], tg_argv[2]) into actual using parent_id;
    if actual <> expected then raise exception 'Incomplete publication inventory: %', tg_table_name using errcode = '23514'; end if;
    return null;
end;
$$;
create trigger complete_period_insert after insert on public.sku_fee_periods
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'public.sku_terms_versions', 'fee_period_count', 'terms_version_id'
);
create constraint trigger complete_period_set after insert on public.sku_terms_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'public.sku_fee_periods', 'fee_period_count', 'terms_version_id'
);
create trigger complete_settlement_insert after insert
on private.settlement_transactions referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.settlement_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_settlement_set
after insert on private.settlement_preprocess_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.settlement_transactions', 'row_count', 'version_id'
);
create trigger complete_day_insert after insert on private.data_kiosk_transactions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_day_set after insert on private.data_kiosk_preprocess_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.data_kiosk_transactions', 'row_count', 'version_id'
);
create trigger complete_batch_insert after insert
on private.data_kiosk_preprocess_versions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_batches', 'day_count', 'batch_id'
);
create constraint trigger complete_batch_set after insert on private.data_kiosk_preprocess_batches
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.data_kiosk_preprocess_versions', 'day_count', 'batch_id'
);

create function private.guard_current_reference() returns trigger language plpgsql
set search_path = '' as $$
declare current_source record; previous_source record;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_version_id') is distinct from (to_jsonb(old) - 'current_version_id') then
        raise exception 'Published identity cannot change' using errcode = '23514';
    end if;
    if new.current_version_id is null or (tg_table_name <> 'data_kiosk_days'
        and old.current_version_id is not null and new.current_version_id <= old.current_version_id) then
        raise exception 'Current version must advance through publication' using errcode = '23514';
    end if;
    if tg_table_name = 'data_kiosk_days' then
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = new.current_version_id) then
            raise exception 'A pruned payload cannot become current' using errcode = '23514';
        end if;
        select a.root_query_created_at,a.id into current_source
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.id = new.current_version_id;
        select a.root_query_created_at,a.id into previous_source
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.id = old.current_version_id;
        if old.current_version_id is not null and (
            (current_source.root_query_created_at,current_source.id) < (previous_source.root_query_created_at,previous_source.id)
            or (current_source.id = previous_source.id and new.current_version_id <= old.current_version_id)
        ) then raise exception 'Data Kiosk observation selection cannot move backward' using errcode = '23514'; end if;
    end if;
    return new;
end;
$$;
create trigger immutable_identity before update or delete on private.settlements
for each row execute function private.guard_current_reference();
create trigger immutable_identity before update or delete on private.data_kiosk_days
for each row execute function private.guard_current_reference();

create function private.guard_current_sku_terms() returns trigger
language plpgsql set search_path = '' as $$
declare chosen public.sku_terms_versions; previous_number bigint;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_terms_version_id') is distinct from
        (to_jsonb(old) - 'current_terms_version_id') then
        raise exception 'Seller/SKU identity is immutable' using errcode = '23514';
    end if;
    if new.current_terms_version_id is null then
        raise exception 'Publish an unassigned revision instead of clearing selection' using errcode = '23514';
    end if;
    if new.current_terms_version_id is not distinct from old.current_terms_version_id then return new; end if;
    select * into chosen from public.sku_terms_versions where id = new.current_terms_version_id;
    if not found or chosen.seller_sku_id <> new.id then
        raise exception 'Selected terms must belong to this seller/SKU' using errcode = '23503';
    end if;
    if chosen.fee_period_count <> (
        select count(*) from public.sku_fee_periods where terms_version_id = chosen.id
    ) then raise exception 'Selected terms have an incomplete fee inventory' using errcode = '23514'; end if;
    select version_number into previous_number from public.sku_terms_versions where id = old.current_terms_version_id;
    if previous_number is not null and chosen.version_number <= previous_number then
        raise exception 'Terms selection must advance through publication' using errcode = '23514';
    end if;
    return new;
end;
$$;
create trigger immutable_identity before update or delete on public.seller_skus
for each row execute function private.guard_current_sku_terms();

create function private.require_selected_sku_terms() returns trigger
language plpgsql set search_path = '' as $$
begin
    if exists (select 1 from public.seller_skus where id = new.id and current_terms_version_id is null) then
        raise exception 'A registered seller/SKU requires selected terms' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger selected_terms_required after insert on public.seller_skus
deferrable initially deferred for each row execute function private.require_selected_sku_terms();

create function private.publish_sku_terms(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare identity public.seller_skus; published_version_id public.local_uuid := (p_payload->>'id')::uuid;
    next_version_number bigint;
begin
    if jsonb_typeof(p_payload) is distinct from 'object'
        or not (p_payload ?& array['id','seller_sku_id','seller_namespace','sku','company_id',
            'expected_current_version_id','change_reason','periods'])
        or jsonb_typeof(p_payload->'periods') is distinct from 'array'
        or jsonb_typeof(p_payload->'seller_namespace') is distinct from 'string'
        or jsonb_typeof(p_payload->'sku') is distinct from 'string'
        or jsonb_typeof(p_payload->'change_reason') is distinct from 'string' then
        raise exception 'Explicit owner, expected selection, and complete terms payload required' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'sku-terms',p_payload->>'seller_namespace',p_payload->>'sku')::text,0));
    insert into public.seller_skus(id,seller_namespace,sku)
        values ((p_payload->>'seller_sku_id')::uuid,p_payload->>'seller_namespace',p_payload->>'sku')
        on conflict (seller_namespace,sku) do nothing;
    select * into strict identity from public.seller_skus s
        where s.seller_namespace = p_payload->>'seller_namespace' and s.sku = p_payload->>'sku' for update;
    if identity.current_terms_version_id is distinct from (p_payload->>'expected_current_version_id')::uuid then
        raise exception 'Stale seller/SKU terms publication' using errcode = '40001';
    end if;
    select coalesce(max(v.version_number),0) + 1 into next_version_number
        from public.sku_terms_versions v where v.seller_sku_id = identity.id;
    insert into public.sku_terms_versions(id,seller_sku_id,company_id,version_number,fee_period_count,change_reason)
        values (published_version_id,identity.id,(p_payload->>'company_id')::uuid,next_version_number,
            jsonb_array_length(p_payload->'periods'),p_payload->>'change_reason');
    insert into public.sku_fee_periods(id,terms_version_id,marketplace_name,valid_period,fee_rate_percent)
        select (period_payload->>'id')::uuid,published_version_id,
            period_payload->>'marketplace_name',
            daterange((period_payload->>'valid_from')::date,(period_payload->>'valid_to')::date,'[)'),
            (period_payload->>'fee_rate_percent')::numeric
        from jsonb_array_elements(p_payload->'periods') as periods(period_payload);
    update public.seller_skus set current_terms_version_id = published_version_id where id = identity.id;
    return published_version_id;
end;
$$;

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

create function private.require_read_committed() returns void language plpgsql
set search_path = '' as $$
begin
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Source retention and payout publication require READ COMMITTED isolation'
            using errcode = '25000';
    end if;
end;
$$;

create function private.guard_data_kiosk_payload_mutation() returns trigger language plpgsql
set search_path = '' as $$
begin
    if tg_op <> 'DELETE' or not exists (
        select 1 from private.data_kiosk_pruned_versions p where p.version_id = old.version_id
    ) then raise exception 'Data Kiosk published facts are immutable' using errcode = '23514'; end if;
    return old;
end;
$$;
create trigger immutable before update or delete on private.data_kiosk_transactions
for each row execute function private.guard_data_kiosk_payload_mutation();
create trigger immutable_truncate before truncate on private.settlement_transactions
for each statement execute function private.reject_mutation();
create trigger immutable_truncate before truncate on private.data_kiosk_transactions
for each statement execute function private.reject_mutation();

create function private.guard_data_kiosk_retention() returns trigger language plpgsql
set search_path = '' as $$
declare target_day_id uuid; observation_rank bigint;
begin
    perform private.require_read_committed();
    select v.day_id into strict target_day_id from private.data_kiosk_preprocess_versions v where v.id = new.version_id;
    perform 1 from private.data_kiosk_days d where d.id = target_day_id for update;
    if tg_table_name = 'payout_report_data_kiosk_versions' then
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = new.version_id) then
            raise exception 'Pruned evidence must be reprocessed before a payout report can reference it' using errcode = '23514';
        end if;
        return new;
    end if;
    if exists (select 1 from private.data_kiosk_days d where d.current_version_id = new.version_id)
        or exists (select 1 from private.payout_report_data_kiosk_versions p where p.version_id = new.version_id) then
        raise exception 'Current or payout-referenced evidence cannot be pruned' using errcode = '23514';
    end if;
    with observations as (
        select distinct a.id,a.root_query_created_at from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.day_id = target_day_id
    ), ranked as (
        select id,row_number() over (order by root_query_created_at desc,id desc) as rank from observations
    ) select r.rank into observation_rank from ranked r
        join private.data_kiosk_preprocess_batches b on b.acquisition_id = r.id
        join private.data_kiosk_preprocess_versions v on v.batch_id = b.id where v.id = new.version_id;
    if observation_rank <= 3 then
        raise exception 'Latest three source observations must be retained' using errcode = '23514';
    end if;
    return new;
end;
$$;
create trigger preserve_required_evidence before insert on private.data_kiosk_pruned_versions
for each row execute function private.guard_data_kiosk_retention();

create function private.prune_data_kiosk_preprocess(
    p_keep_observations integer default 3
) returns integer
language plpgsql set search_path = '' as $$
declare candidate record; removed integer := 0;
begin
    perform private.require_read_committed();
    if p_keep_observations is null or p_keep_observations < 3 then
        raise exception 'Retain at least three observations' using errcode = '23514';
    end if;
    for candidate in
        with observations as (
            select distinct v.day_id,a.id,a.root_query_created_at
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id
        ), ranked as (
            select *,row_number() over (partition by day_id order by root_query_created_at desc,id desc) as observation_rank
            from observations
        )
        select v.id,v.day_id from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_days d on d.id = v.day_id
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        join ranked r on r.day_id = v.day_id and r.id = b.acquisition_id
        where r.observation_rank > p_keep_observations
          and not exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = v.id)
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key,v.id
    loop
        perform 1 from private.data_kiosk_days d where d.id = candidate.day_id for update;
        -- Recheck after waiting: another retention operation may have completed.
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = candidate.id)
           or exists (select 1 from private.data_kiosk_days d where d.current_version_id = candidate.id)
           or exists (select 1 from private.payout_report_data_kiosk_versions p where p.version_id = candidate.id) then continue; end if;
        insert into private.data_kiosk_pruned_versions(version_id) values (candidate.id);
        delete from private.data_kiosk_transactions where version_id = candidate.id;
        removed := removed + 1;
    end loop;
    return removed;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
