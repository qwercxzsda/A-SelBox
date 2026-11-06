-- Capture current inputs, reuse the latest matching report, or save one immutable aggregate.
-- noqa: disable=AM04
-- Equal totals alone are insufficient: reuse requires the same immutable inputs.
-- Calendar validation fixes the end date and dataset; reuse matches the exact
-- marketplace and currency as well as every available immutable input version.
create function private.matching_latest_payout_report(
    p_report public.company_payout_reports,
    p_finances_runs uuid[], p_kiosk_versions uuid[], p_terms_versions uuid[]
) returns uuid language sql stable set search_path = '' as $$
    with latest as (
        select r.* from public.company_payout_reports r
        where r.company_id = (p_report).company_id
            and r.marketplace_name is not distinct from (p_report).marketplace_name
            and r.currency is not distinct from (p_report).currency
            and r.start_date = (p_report).start_date
        order by r.created_at desc, r.id desc limit 1
    )
    select r.id from latest r
    where r.calculation_version = 'v1'
        and r.finances_batch_count = cardinality(p_finances_runs)
        and r.data_kiosk_version_count = cardinality(p_kiosk_versions)
        and r.terms_version_count = cardinality(p_terms_versions)
        and not exists (
            select 1 from private.payout_report_finances_batches v
            where v.report_id = r.id and not (v.batch_id = any(p_finances_runs))
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
declare report_input public.company_payout_reports;
    finances_runs uuid[]; kiosk_versions uuid[]; terms_versions uuid[]; used_terms uuid[];
    locked_identity record; locked_day_ids uuid[] := '{}'; existing_report_id uuid;
    seller_namespaces text[]; locked_seller text; has_amounts boolean;
begin
    perform private.require_read_committed();
    if jsonb_typeof(p_payload) is distinct from 'object'
        or not p_payload ?& array['id','company_id','marketplace_name','currency','start_date','end_date',
            'dataset_key','report_name','change_reason']
        or p_payload ?| array['seller_namespace','preprocess_version','finances_batch_ids'] then
        raise exception 'Complete payout publication scope required' using errcode = '23514';
    end if;
    report_input := jsonb_populate_record(null::public.company_payout_reports,p_payload);
    if report_input.id is null or report_input.company_id is null
        or (report_input.currency is not null and report_input.currency !~ '^[A-Z]{3}$')
        or report_input.report_name is null or report_input.change_reason is null
        or report_input.start_date is null or report_input.end_date is null
        or not isfinite(report_input.start_date) or not isfinite(report_input.end_date)
        or report_input.start_date > report_input.end_date
        or report_input.dataset_key is distinct from 'economics' then
        raise exception 'Invalid payout publication scope' using errcode = '23514';
    end if;
    if report_input.end_date <> private.payout_month_end(report_input.start_date) then
        raise exception 'A payout report must cover exactly one complete calendar month' using errcode = '22023';
    end if;
    -- Match the worker's input lock before all company/source locks. Current SKU
    -- ownership cannot disappear between eligibility and the captured manifest.
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    if not private.payout_company_eligible(report_input.company_id) then
        raise exception 'Payout reports require at least one currently assigned SKU'
        using errcode = '23514';
    end if;
    -- All entry points lock company/month before ordered seller/month locks.
    -- This also serializes an empty scope that has no seller to lock.
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'company_payout_month',report_input.company_id,report_input.start_date
    )::text,0));
    -- A generation batch fixes its seller set before taking any seller locks.
    -- Re-discovery here could introduce an earlier seller and reverse lock order.
    if p_payload ? 'captured_seller_namespaces' then
        if jsonb_typeof(p_payload->'captured_seller_namespaces') is distinct from 'array' then
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
        seller_namespaces := private.payout_company_sellers(report_input.company_id);
    end if;
    foreach locked_seller in array seller_namespaces loop
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'company_payout_report',locked_seller,report_input.start_date
        )::text,0));
    end loop;
    finances_runs := private.payout_finances_batch_ids(
        seller_namespaces,report_input.start_date,report_input.end_date);
    -- Data Kiosk retention uses day locks; the shared input guard already
    -- serializes Finance publication against this immutable run selection.
    for locked_identity in
        select d.id from private.data_kiosk_days d
        where d.seller_namespace = any(seller_namespaces)
          and d.current_version_id is not null
          and d.activity_date between report_input.start_date and report_input.end_date
          and d.dataset_key = report_input.dataset_key
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key
    loop
        perform 1 from private.data_kiosk_days where id = locked_identity.id for update;
        locked_day_ids := array_append(locked_day_ids,locked_identity.id);
    end loop;
    -- One snapshot captures all selections; the remaining calculation and all
    -- manifest rows use these exact UUIDs. Fee publications need no source locks.
    -- Capture immutable runs and available Data Kiosk days; require complete month
    -- coverage only when the requested company scope has authoritative rows.
    select
        (select coalesce(array_agg(d.current_version_id order by d.id),'{}'::uuid[])
         from private.data_kiosk_days d where d.id = any(locked_day_ids)),
        (select coalesce(array_agg(s.current_terms_version_id order by s.id),'{}'::uuid[])
         from public.skus s where s.current_terms_version_id is not null and (
             s.sku in (
                 select t.sku from private.finances_batch_components t
                 where t.batch_id = any(finances_runs) and t.activity_eligible
                     and t.posted_date between report_input.start_date and report_input.end_date
                 union all
                 select t.sku from private.data_kiosk_transactions t
                 join private.data_kiosk_days d on d.current_version_id = t.version_id
                 where d.id = any(locked_day_ids)
             ) or exists (
                 select 1 from public.sku_terms_versions v
                 where v.sku_id = s.id and v.company_id = report_input.company_id
             )
         ))
    into kiosk_versions,terms_versions;
    -- The worker runs as a trusted database role. Recreate the temporary relation
    -- so inherited temporary tables or triggers cannot alter the calculation.
    drop table if exists pg_temp.payout_resolved_components;
    create temporary table payout_resolved_components on commit drop as
        select c.* from private.resolve_company_components(finances_runs,kiosk_versions,terms_versions) c
        where c.seller_namespace = any(seller_namespaces)
          and c.category <> 'SELBOX'
          and (c.authoritative or (c.source = 'DATA_KIOSK' and c.company_id is not null))
          and c.activity_date between report_input.start_date and report_input.end_date;
    if exists (select 1 from pg_temp.payout_resolved_components
               where authoritative and (company_id is null
                   or (company_id = report_input.company_id and currency = report_input.currency
                       and marketplace_name is not distinct from report_input.marketplace_name
                       and resolution_status not in ('APPLIED','NOT_APPLICABLE')))) then
        raise exception 'Unresolved ownership or fee coverage prevents a complete payout report' using errcode = '23514';
    end if;
    select exists(select 1 from pg_temp.payout_resolved_components
        where authoritative and company_id = report_input.company_id
            and marketplace_name is not distinct from report_input.marketplace_name
            and (report_input.currency is null or currency = report_input.currency)) into has_amounts;
    if report_input.currency is null and has_amounts then
        raise exception 'Company amounts require a currency scope' using errcode = '23514';
    end if;
    perform private.assert_payout_sources(report_input.start_date,report_input.end_date,
        report_input.dataset_key,finances_runs,kiosk_versions,has_amounts,seller_namespaces);
    select case when has_amounts
        then coalesce(array_agg(distinct terms_version_id),'{}'::uuid[]) else terms_versions end
        into used_terms from pg_temp.payout_resolved_components;
    existing_report_id := private.matching_latest_payout_report(
        report_input,finances_runs,kiosk_versions,used_terms);
    if existing_report_id is not null then
        return existing_report_id;
    end if;
    drop table if exists pg_temp.payout_reconciliation;
    create temporary table payout_reconciliation on commit drop as
        select r.* from private.resolve_source_reconciliation(finances_runs,kiosk_versions) r
        where report_input.currency is not null and r.activity_date between report_input.start_date and report_input.end_date
            and r.marketplace_name is not distinct from report_input.marketplace_name
            and r.currency = report_input.currency;
    insert into public.company_payout_reports (
        id,company_id,marketplace_name,currency,start_date,end_date,dataset_key,
        report_name,change_reason,calculation_version,component_count,reconciliation_count,
        finances_batch_count,data_kiosk_version_count,terms_version_count,
        source_amount,fee_amount,company_amount
    ) select report_input.id,report_input.company_id,report_input.marketplace_name,report_input.currency,
        report_input.start_date,report_input.end_date,report_input.dataset_key,
        report_input.report_name,report_input.change_reason,'v1',
        count(*)::integer,
        (select count(*)::integer from pg_temp.payout_reconciliation),
        cardinality(finances_runs),cardinality(kiosk_versions),cardinality(used_terms),
        coalesce(sum(source_amount) filter (where authoritative),0),
        coalesce(sum(fee_amount) filter (where authoritative),0),
        coalesce(sum(company_amount) filter (where authoritative),0)
        from pg_temp.payout_resolved_components
        where company_id = report_input.company_id and currency = report_input.currency
            and marketplace_name is not distinct from report_input.marketplace_name;
    insert into private.payout_report_finances_batches(report_id,batch_id)
        select report_input.id, unnest(finances_runs);
    insert into private.payout_report_data_kiosk_versions(report_id,day_id,version_id)
        select report_input.id,v.day_id,v.id from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_days d on d.id = v.day_id where v.id = any(kiosk_versions)
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key;
    insert into private.payout_report_terms_versions(report_id,sku_id,terms_version_id)
        select report_input.id,v.sku_id,v.id from public.sku_terms_versions v
        where v.id = any(used_terms);
    insert into public.company_payout_report_components (
        report_id,row_number,source,authoritative,source_row_id,source_version_id,source_identity_id,
        sku_id,terms_version_id,fee_period_id,sku,marketplace_name,activity_date,component_type,
        source_amount,quantity,fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
    ) select report_input.id,
        row_number() over(order by source,source_identity_id,source_row_id)::integer,
        source,authoritative,source_row_id,source_version_id,source_identity_id,sku_id,terms_version_id,
        fee_period_id,sku,marketplace_name,activity_date,component_type,source_amount,quantity,
        fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
        from pg_temp.payout_resolved_components
        where company_id = report_input.company_id and currency = report_input.currency
            and marketplace_name is not distinct from report_input.marketplace_name;
    insert into private.payout_report_reconciliation (
        report_id,row_number,seller_namespace,activity_date,marketplace_name,currency,
        finances_category_amount,selbox_category_amount,data_kiosk_finances_control,data_kiosk_category_amount,difference,
        finances_total,accounted_total
    ) select report_input.id,
        row_number() over(order by r.seller_namespace,r.activity_date,r.marketplace_name nulls first,r.currency)::integer,
        r.seller_namespace,r.activity_date,r.marketplace_name,r.currency,
        r.finances_category_amount,r.selbox_category_amount,r.data_kiosk_finances_control,r.data_kiosk_category_amount,r.difference,
        r.finances_total,r.accounted_total
      from pg_temp.payout_reconciliation r;
    return report_input.id;
end;
$$;
