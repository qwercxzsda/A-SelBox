-- Capture current inputs, reuse the latest matching report, or save one immutable aggregate.
-- noqa: disable=AM04
-- Equal totals alone are insufficient: reuse requires the same immutable inputs.
-- Calendar validation fixes the end date and dataset. Incomplete empty scopes
-- need declared marketplace equality as well as identical available versions.
create function private.matching_latest_payout_report(
    p_report public.company_payout_reports,
    p_settlement_versions uuid[], p_kiosk_versions uuid[], p_terms_versions uuid[]
) returns uuid language sql stable set search_path = '' as $$
    with latest as (
        select r.* from public.company_payout_reports r
        where r.company_id = (p_report).company_id
            and r.seller_namespace is not distinct from (p_report).seller_namespace
            and r.currency is not distinct from (p_report).currency
            and r.start_date = (p_report).start_date
        order by r.created_at desc, r.id desc limit 1
    )
    select r.id from latest r
    where r.preprocess_version is not distinct from (p_report).preprocess_version
        and r.calculation_version = 'v1'
        and r.marketplace_names @> (p_report).marketplace_names
        and r.marketplace_names <@ (p_report).marketplace_names
        and r.settlement_version_count = cardinality(p_settlement_versions)
        and r.data_kiosk_version_count = cardinality(p_kiosk_versions)
        and r.terms_version_count = cardinality(p_terms_versions)
        and not exists (
            select 1 from private.payout_report_settlement_versions v
            where v.report_id = r.id and not (v.version_id = any(p_settlement_versions))
        )
        and not exists (
            select 1 from private.payout_report_data_kiosk_versions v
            where v.report_id = r.id and not (v.version_id = any(p_kiosk_versions))
        )
        and not exists (
            select 1 from private.payout_report_terms_versions v
            where v.report_id = r.id and not (v.terms_version_id = any(p_terms_versions))
        );
$$;

create function private.publish_company_payout_report(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare report_input public.company_payout_reports; settlement_ids uuid[];
    settlement_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[]; used_terms uuid[];
    locked_identity record; locked_day_ids uuid[] := '{}'; existing_report_id uuid;
    seller_namespaces text[]; locked_seller text; has_amounts boolean;
begin
    perform private.require_read_committed();
    if jsonb_typeof(p_payload) is distinct from 'object'
        or not p_payload ?& array['id','company_id','seller_namespace','currency','start_date','end_date',
            'preprocess_version','dataset_key','marketplace_names','report_name','change_reason','settlement_ids']
        or jsonb_typeof(p_payload->'settlement_ids') is distinct from 'array'
        or jsonb_typeof(p_payload->'marketplace_names') is distinct from 'array' then
        raise exception 'Complete payout publication scope required' using errcode = '23514';
    end if;
    report_input := jsonb_populate_record(null::public.company_payout_reports,p_payload);
    select coalesce(array_agg(value::uuid order by value),'{}'::uuid[]) into settlement_ids
        from jsonb_array_elements_text(p_payload->'settlement_ids') value;
    if report_input.id is null or report_input.company_id is null
        or num_nonnulls(report_input.seller_namespace,report_input.currency,report_input.preprocess_version) not in (0,3)
        or (report_input.currency is not null and report_input.currency !~ '^[A-Z]{3}$')
        or report_input.marketplace_names is null
        or (report_input.seller_namespace is null and cardinality(report_input.marketplace_names) <> 0)
        or array_ndims(report_input.marketplace_names) > 1
        or array_position(report_input.marketplace_names,null) is not null
        or not (report_input.marketplace_names <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
        ]::text[])
        or report_input.report_name is null or report_input.change_reason is null
        or report_input.start_date is null or report_input.end_date is null
        or not isfinite(report_input.start_date) or not isfinite(report_input.end_date)
        or report_input.start_date > report_input.end_date
        or array_position(settlement_ids,null) is not null
        or cardinality(settlement_ids) <> (select count(distinct value) from unnest(settlement_ids) value) then
        raise exception 'Invalid payout publication scope' using errcode = '23514';
    end if;
    if report_input.end_date <> private.payout_month_end(report_input.start_date) then
        raise exception 'A payout report must cover exactly one complete calendar month' using errcode = '22023';
    end if;
    -- All entry points lock company/month before ordered seller/month locks.
    -- This also serializes an empty scope that has no seller to lock.
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'company_payout_month',report_input.company_id,report_input.start_date
    )::text,0));
    -- A generation batch fixes its seller set before taking any seller locks.
    -- Re-discovery here could introduce an earlier seller and reverse lock order.
    if p_payload ? 'captured_seller_namespaces' then
        if report_input.seller_namespace is not null
            or jsonb_typeof(p_payload->'captured_seller_namespaces') is distinct from 'array' then
            raise exception 'Invalid captured payout seller scope' using errcode = '23514';
        end if;
        if exists (select 1 from jsonb_array_elements(p_payload->'captured_seller_namespaces') item
            where jsonb_typeof(item) <> 'string' or nullif(btrim(item #>> '{}'),'') is null) then
            raise exception 'Invalid captured payout seller scope' using errcode = '23514';
        end if;
        select coalesce(array_agg(value order by value),'{}'::text[]) into seller_namespaces
            from jsonb_array_elements_text(p_payload->'captured_seller_namespaces') value;
        if cardinality(seller_namespaces) <> (select count(distinct value) from unnest(seller_namespaces) value)
            or not (seller_namespaces <@ private.payout_company_sellers(report_input.company_id)) then
            raise exception 'Invalid captured payout seller scope' using errcode = '23514';
        end if;
    else
        seller_namespaces := case when report_input.seller_namespace is null
            then private.payout_company_sellers(report_input.company_id)
            else array[report_input.seller_namespace::text] end;
    end if;
    foreach locked_seller in array seller_namespaces loop
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'company_payout_report',locked_seller,report_input.start_date
        )::text,0));
    end loop;
    if report_input.seller_namespace is null then
        settlement_ids := private.payout_settlement_ids(
            seller_namespaces,report_input.start_date,report_input.end_date);
    end if;
    -- Every publisher uses day natural order. Capture only after obtaining locks;
    -- READ COMMITTED then observes pruning/source publications that finished first.
    for locked_identity in
        select d.id from private.data_kiosk_days d
        where d.seller_namespace = any(seller_namespaces)
          and (report_input.seller_namespace is null or d.marketplace_name = any(report_input.marketplace_names))
          and d.current_version_id is not null
          and d.activity_date between report_input.start_date and report_input.end_date
          and d.dataset_key = report_input.dataset_key
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key
    loop
        perform 1 from private.data_kiosk_days where id = locked_identity.id for update;
        locked_day_ids := array_append(locked_day_ids,locked_identity.id);
    end loop;
    for locked_identity in
        select s.id from private.settlements s where s.id = any(settlement_ids)
        order by s.seller_namespace,s.amazon_scope,s.settlement_id
    loop
        perform 1 from private.settlements where id = locked_identity.id for update;
    end loop;
    -- One snapshot captures all selections; the remaining calculation and all
    -- manifest rows use these exact UUIDs. Fee publications need no source locks.
    -- Capture every available selected day, then require complete declared month
    -- coverage only when the requested company scope has authoritative rows.
    select
        (select coalesce(array_agg(s.current_version_id order by s.id),'{}'::uuid[])
         from private.settlements s where s.id = any(settlement_ids)),
        (select coalesce(array_agg(d.current_version_id order by d.id),'{}'::uuid[])
         from private.data_kiosk_days d where d.id = any(locked_day_ids)),
        (select coalesce(array_agg(s.current_terms_version_id order by s.id),'{}'::uuid[])
         from public.seller_skus s where s.seller_namespace = any(seller_namespaces)
             and s.current_terms_version_id is not null)
    into settlement_versions,kiosk_versions,terms_versions;
    if cardinality(settlement_versions) <> cardinality(settlement_ids) then
        raise exception 'Missing required payout Settlement identity' using errcode = '23514';
    end if;
    -- The operator RPC runs with definer privileges. Never reuse a caller-owned
    -- temporary relation, whose triggers could otherwise execute as the definer.
    drop table if exists pg_temp.payout_resolved_components;
    create temporary table payout_resolved_components on commit drop as
        select c.* from private.resolve_company_components(settlement_versions,kiosk_versions,terms_versions) c
        where c.seller_namespace = any(seller_namespaces)
          and c.category <> 'SELBOX'
          and (c.authoritative or (c.source = 'DATA_KIOSK' and c.company_id is not null))
          and c.activity_date between report_input.start_date and report_input.end_date;
    if exists (select 1 from pg_temp.payout_resolved_components
               where authoritative and (company_id is null
                   or (company_id = report_input.company_id and currency = report_input.currency
                       and resolution_status not in ('APPLIED','NOT_APPLICABLE')))) then
        raise exception 'Unresolved ownership or fee coverage prevents a complete payout report' using errcode = '23514';
    end if;
    select exists(select 1 from pg_temp.payout_resolved_components
        where authoritative and company_id = report_input.company_id
            and (report_input.currency is null or currency = report_input.currency)) into has_amounts;
    if report_input.currency is null and has_amounts then
        raise exception 'Company amounts require a seller and currency scope' using errcode = '23514';
    end if;
    perform private.assert_payout_source_versions(report_input.seller_namespace,report_input.start_date,
        report_input.end_date,report_input.preprocess_version,report_input.marketplace_names,
        report_input.dataset_key,settlement_versions,kiosk_versions,has_amounts);
    select case when has_amounts
        then coalesce(array_agg(distinct terms_version_id),'{}'::uuid[]) else terms_versions end
        into used_terms from pg_temp.payout_resolved_components;
    existing_report_id := private.matching_latest_payout_report(
        report_input,settlement_versions,kiosk_versions,used_terms);
    if existing_report_id is not null then
        return existing_report_id;
    end if;
    drop table if exists pg_temp.payout_reconciliation;
    create temporary table payout_reconciliation on commit drop as
        select r.* from private.resolve_source_reconciliation(settlement_versions,kiosk_versions) r
        where r.seller_namespace = report_input.seller_namespace
            and r.activity_date between report_input.start_date and report_input.end_date;
    insert into public.company_payout_reports (
        id,company_id,seller_namespace,currency,start_date,end_date,preprocess_version,dataset_key,
        marketplace_names,report_name,change_reason,calculation_version,component_count,reconciliation_count,
        settlement_version_count,data_kiosk_version_count,terms_version_count,
        source_amount,fee_amount,company_amount
    ) select report_input.id,report_input.company_id,report_input.seller_namespace,report_input.currency,
        report_input.start_date,report_input.end_date,report_input.preprocess_version,report_input.dataset_key,
        report_input.marketplace_names,report_input.report_name,report_input.change_reason,'v1',
        count(*)::integer,
        (select count(*)::integer from pg_temp.payout_reconciliation),
        cardinality(settlement_versions),cardinality(kiosk_versions),cardinality(used_terms),
        coalesce(sum(source_amount) filter (where authoritative),0),
        coalesce(sum(fee_amount) filter (where authoritative),0),
        coalesce(sum(company_amount) filter (where authoritative),0)
        from pg_temp.payout_resolved_components
        where company_id = report_input.company_id and currency = report_input.currency;
    insert into private.payout_report_settlement_versions(report_id,settlement_id,version_id)
        select report_input.id,v.settlement_id,v.id from private.settlement_preprocess_versions v
        where v.id = any(settlement_versions);
    insert into private.payout_report_data_kiosk_versions(report_id,day_id,version_id)
        select report_input.id,v.day_id,v.id from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_days d on d.id = v.day_id where v.id = any(kiosk_versions)
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key;
    insert into private.payout_report_terms_versions(report_id,seller_sku_id,terms_version_id)
        select report_input.id,v.seller_sku_id,v.id from public.sku_terms_versions v
        where v.id = any(used_terms);
    insert into public.company_payout_report_components (
        report_id,row_number,source,authoritative,source_row_id,source_version_id,source_identity_id,
        seller_sku_id,terms_version_id,fee_period_id,sku,marketplace_name,activity_date,component_type,
        source_amount,quantity,fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
    ) select report_input.id,
        row_number() over(order by source,source_identity_id,source_row_id)::integer,
        source,authoritative,source_row_id,source_version_id,source_identity_id,seller_sku_id,terms_version_id,
        fee_period_id,sku,marketplace_name,activity_date,component_type,source_amount,quantity,
        fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
        from pg_temp.payout_resolved_components
        where company_id = report_input.company_id and currency = report_input.currency;
    insert into private.payout_report_reconciliation (
        report_id,row_number,seller_namespace,activity_date,marketplace_name,currency,
        settlement_category_amount,selbox_category_amount,data_kiosk_settlement_control,data_kiosk_category_amount,difference,
        settlement_total,accounted_total
    ) select report_input.id,
        row_number() over(order by r.activity_date,r.marketplace_name nulls first,r.currency)::integer,
        r.seller_namespace,r.activity_date,r.marketplace_name,r.currency,
        r.settlement_category_amount,r.selbox_category_amount,r.data_kiosk_settlement_control,r.data_kiosk_category_amount,r.difference,
        r.settlement_total,r.accounted_total
      from pg_temp.payout_reconciliation r;
    return report_input.id;
end;
$$;
