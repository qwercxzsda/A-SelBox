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
