-- Publish a complete immutable ownership/fee revision using compare-and-swap.
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
revoke all on all functions in schema private from public, anon, authenticated, service_role;
