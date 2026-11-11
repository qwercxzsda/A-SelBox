-- Capture current inputs, reuse the latest matching report, or save one immutable aggregate.
-- noqa: disable=AM04
-- Equal totals alone are insufficient: reuse requires the same immutable inputs.
-- Calendar validation fixes the end date and dataset; reuse matches the exact
-- marketplace and currency as well as every available immutable input version.
create function private.matching_latest_payout_report(
    p_report public.company_payout_reports,
    p_finances_versions uuid[], p_kiosk_versions uuid[], p_terms_versions uuid[]
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
    where r.source_coverage = (p_report).source_coverage
        and r.finances_version_count = cardinality(p_finances_versions)
        and r.data_kiosk_version_count = cardinality(p_kiosk_versions)
        and r.terms_version_count = cardinality(p_terms_versions)
        and not exists (
            select 1 from private.payout_report_finances_versions v
            where v.report_id = r.id and not (v.version_id = any(p_finances_versions))
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
    finances_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[]; used_terms uuid[];
    existing_report_id uuid; seller_namespaces text[]; aggregate record;
begin
    perform private.require_read_committed();
    if jsonb_typeof(p_payload) is distinct from 'object' then
        raise exception 'Complete payout publication scope required' using errcode = '23514';
    end if;
    if not p_payload ?& array['id','company_id','marketplace_name','currency','start_date','end_date',
            'dataset_key','change_reason']
        or exists (select 1 from jsonb_object_keys(p_payload) key where key <> all(
            array['id','company_id','marketplace_name','currency','start_date','end_date',
                'dataset_key','change_reason'])) then
        raise exception 'Complete payout publication scope required' using errcode = '23514';
    end if;
    report_input := jsonb_populate_record(null::public.company_payout_reports,p_payload);
    if report_input.id is null or report_input.company_id is null
        or (report_input.currency is not null and report_input.currency !~ '^[A-Z]{3}$')
        or report_input.change_reason is null
        or report_input.start_date is null or report_input.end_date is null
        or not isfinite(report_input.start_date) or not isfinite(report_input.end_date)
        or report_input.start_date > report_input.end_date
        or report_input.dataset_key is distinct from 'economics' then
        raise exception 'Invalid payout publication scope' using errcode = '23514';
    end if;
    if report_input.end_date <> private.payout_month_end(report_input.start_date) then
        raise exception 'A payout report must cover exactly one complete calendar month' using errcode = '22023';
    end if;
    -- Every source/fee publisher takes the shared input guard before writing.
    -- This exclusive guard freezes eligibility and all current version selections
    -- for both direct publication and the entire monthly generation transaction.
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    if not private.payout_company_eligible(report_input.company_id) then
        raise exception 'Payout reports require at least one currently assigned SKU'
        using errcode = '23514';
    end if;
    seller_namespaces := private.payout_company_sellers(report_input.company_id);
    -- The exclusive input guard freezes these current selections for this publication.
    -- Observation-only changes do not alter the pinned revision set.
    select coalesce(array_agg(t.current_version_id order by t.id),'{}'::uuid[])
        into finances_versions from private.finances_transactions t
        join private.finances_transaction_versions v on v.id=t.current_version_id
        where t.seller_namespace=any(seller_namespaces)
            and v.posted_date between report_input.start_date and report_input.end_date
            and (report_input.marketplace_name is null or v.marketplace_name=report_input.marketplace_name);
    select coalesce(array_agg(d.current_version_id order by d.id),'{}'::uuid[])
        into kiosk_versions from private.data_kiosk_days d
        where d.seller_namespace=any(seller_namespaces)
            and d.current_version_id is not null and d.dataset_key=report_input.dataset_key
            and d.activity_date between report_input.start_date and report_input.end_date
            and (report_input.marketplace_name is null or d.marketplace_name in (
                report_input.marketplace_name,private.finances_data_kiosk_marketplace(report_input.marketplace_name)));
    select coalesce(array_agg(s.current_terms_version_id order by s.id),'{}'::uuid[])
        into terms_versions from public.skus s where s.current_terms_version_id is not null and (
            s.sku in (
                select t.sku from private.finances_activity_components t where t.version_id=any(finances_versions)
                union all
                select t.sku from private.data_kiosk_day_components t where t.version_id=any(kiosk_versions)
            ) or exists(select 1 from public.sku_terms_versions v
                where v.sku_id=s.id and v.company_id=report_input.company_id)
        );
    -- Resolve once, then retain only aggregate amounts, input IDs and validation
    -- results. Detail rows remain in their immutable source versions.
    select * into aggregate from private.payout_report_aggregate(
        report_input,finances_versions,kiosk_versions,terms_versions);
    used_terms := aggregate.terms_version_ids;
    report_input.component_count := aggregate.component_count;
    report_input.source_amount := aggregate.source_amount;
    report_input.fee_amount := aggregate.fee_amount;
    report_input.company_amount := aggregate.company_amount;
    if aggregate.unresolved then
        raise exception 'Unresolved ownership or fee coverage prevents a complete payout report'
            using errcode = '23514', detail = 'SETUP_REQUIRED';
    end if;
    if report_input.currency is null and aggregate.has_amounts then
        raise exception 'Company amounts require a currency scope' using errcode = '23514';
    end if;
    report_input.source_coverage:=private.payout_source_coverage(
        seller_namespaces,report_input.start_date,report_input.end_date,
        report_input.marketplace_name,finances_versions,aggregate.has_amounts);
    perform private.assert_payout_sources(report_input,finances_versions,kiosk_versions,aggregate.has_amounts);
    if not aggregate.has_amounts then used_terms:=terms_versions; end if;
    existing_report_id := private.matching_latest_payout_report(
        report_input,finances_versions,kiosk_versions,used_terms);
    if existing_report_id is not null then
        return existing_report_id;
    end if;
    insert into public.company_payout_reports (
        id,company_id,marketplace_name,currency,start_date,end_date,dataset_key,
        change_reason,component_count,
        finances_version_count,data_kiosk_version_count,terms_version_count,source_coverage,
        source_amount,fee_amount,company_amount
    ) values (report_input.id,report_input.company_id,report_input.marketplace_name,report_input.currency,
        report_input.start_date,report_input.end_date,report_input.dataset_key,
        report_input.change_reason,report_input.component_count,
        cardinality(finances_versions),cardinality(kiosk_versions),cardinality(used_terms),report_input.source_coverage,
        report_input.source_amount,report_input.fee_amount,report_input.company_amount);
    insert into private.payout_report_finances_versions(report_id,transaction_id,version_id)
        select report_input.id,v.transaction_id,v.id from private.finances_transaction_versions v
        where v.id=any(finances_versions);
    insert into private.payout_report_data_kiosk_versions(report_id,day_id,version_id)
        select report_input.id,v.day_id,v.id from private.data_kiosk_day_versions v
        where v.id=any(kiosk_versions);
    insert into private.payout_report_terms_versions(report_id,sku_id,terms_version_id)
        select report_input.id,v.sku_id,v.id from public.sku_terms_versions v
        where v.id = any(used_terms);
    return report_input.id;
end;
$$;
