-- Payout eligibility, available source validation, and immutable inventory checks.
-- noqa: disable=AM04
-- Both publication entry points use the same calendar-month and mature cutoff date rule.
create function private.payout_month_end(p_month date) returns date
language plpgsql stable security invoker set search_path = '' as $$
declare month_end date;
begin
    if p_month is null or not isfinite(p_month)
        or p_month <> date_trunc('month',p_month)::date then
        raise exception 'Choose the first day of a calendar month' using errcode = '22023';
    end if;
    month_end := (p_month + interval '1 month - 1 day')::date;
    if month_end >= private.mature_cutoff_date() then
        raise exception 'The selected month is not yet eligible for a payout report' using errcode = '22023';
    end if;
    return month_end;
end;
$$;

-- Historical assignments identify a seller even after an ownership correction.
create function private.payout_company_sellers(p_company_id uuid) returns text[]
language sql stable set search_path = '' as $$
    select coalesce(array_agg(seller_namespace order by seller_namespace),'{}'::text[])
    from (
        select s.seller_namespace::text from public.seller_skus s
        join public.sku_terms_versions v on v.seller_sku_id = s.id
        where v.company_id = p_company_id
        union
        select r.seller_namespace::text from public.company_payout_reports r
        where r.company_id = p_company_id and r.seller_namespace is not null
    ) sellers;
$$;

-- Retain empty processed documents as well as documents with monthly rows.
create function private.payout_settlement_ids(p_sellers text[], p_start date, p_end date)
returns uuid[] language sql stable set search_path = '' as $$
    select coalesce(array_agg(s.id order by s.id),'{}'::uuid[])
    from private.settlements s
    join private.settlement_preprocess_versions v on v.id = s.current_version_id
    where s.seller_namespace = any(p_sellers) and (
        (v.settlement_start_date <= p_end and v.settlement_end_date >= p_start)
        or exists (select 1 from private.settlement_transactions t where t.version_id = v.id
            and t.posted_date between p_start and p_end)
    );
$$;

-- Empty aggregates retain the available inputs without claiming complete imports.
-- Nonempty company scopes still require complete compatible Data Kiosk coverage.
create function private.assert_payout_source_versions(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_marketplaces text[], p_dataset_key text,
    p_settlement_versions uuid[], p_data_kiosk_versions uuid[],
    p_require_complete boolean
) returns void language plpgsql set search_path = '' as $$
begin
    if p_settlement_versions is null or p_data_kiosk_versions is null
        or p_marketplaces is null or p_dataset_key is distinct from 'economics'
        or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
        or p_end < p_start or p_require_complete is null
        or (p_require_complete and (p_seller_namespace is null or p_preprocess_version is null))
        or (p_seller_namespace is not null and nullif(btrim(p_seller_namespace),'') is null)
        or (p_preprocess_version is not null and nullif(btrim(p_preprocess_version),'') is null)
        or array_position(p_settlement_versions,null) is not null
        or array_position(p_data_kiosk_versions,null) is not null
        or array_position(p_marketplaces,null) is not null
        or not (p_marketplaces <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
        ]::text[])
        or (select count(distinct value) from unnest(p_marketplaces) value) <> cardinality(p_marketplaces)
        or (select count(distinct value) from unnest(p_settlement_versions) value) <> cardinality(p_settlement_versions)
        or (select count(distinct value) from unnest(p_data_kiosk_versions) value) <> cardinality(p_data_kiosk_versions) then
        raise exception 'Explicit valid payout source scope required' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_settlement_versions) requested(id)
        left join private.settlement_preprocess_versions v on v.id = requested.id
        left join private.settlements s on s.id = v.settlement_id
        where v.id is null
            or (p_seller_namespace is not null and s.seller_namespace <> p_seller_namespace)
            or (p_preprocess_version is not null and v.preprocess_version <> p_preprocess_version)
    ) or (select count(distinct settlement_id) from private.settlement_preprocess_versions
          where id = any(p_settlement_versions)) <> cardinality(p_settlement_versions) then
        raise exception 'Missing, duplicate or incompatible payout Settlement version' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_data_kiosk_versions) requested(id)
        left join private.data_kiosk_preprocess_versions v on v.id = requested.id
        left join private.data_kiosk_days d on d.id = v.day_id
        where v.id is null
            or (p_preprocess_version is not null and v.preprocess_version <> p_preprocess_version)
            or (p_seller_namespace is not null and d.seller_namespace <> p_seller_namespace)
            or d.dataset_key <> p_dataset_key
            or d.activity_date not between p_start and p_end
            or (p_seller_namespace is not null and not (d.marketplace_name = any(p_marketplaces)))
            or exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = v.id)
    ) or (select count(distinct day_id) from private.data_kiosk_preprocess_versions
          where id = any(p_data_kiosk_versions)) <> cardinality(p_data_kiosk_versions)
      or (p_require_complete and cardinality(p_data_kiosk_versions)::bigint
          <> cardinality(p_marketplaces)::bigint * (p_end - p_start + 1))
    then
        raise exception 'Incomplete, pruned or incompatible payout Data Kiosk coverage' using errcode = '23514';
    end if;
    if exists (
        select 1 from (
            select s.seller_namespace,v.preprocess_version
            from private.settlement_preprocess_versions v
            join private.settlements s on s.id = v.settlement_id
            where v.id = any(p_settlement_versions)
            union all
            select d.seller_namespace,v.preprocess_version
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_days d on d.id = v.day_id
            where v.id = any(p_data_kiosk_versions)
        ) versions group by seller_namespace having count(distinct preprocess_version) > 1
    ) then
        raise exception 'Source preprocessing versions must agree for a monthly payout' using errcode = '23514';
    end if;
end;
$$;

-- Verify completed reports against their immutable manifests, never live pointers.
-- This also validates polymorphic component provenance against typed source pins.
-- Deferred checks may run after the authorized publisher has returned to the
-- authenticated role. Validate private evidence as owner without exposing a callable API.
create function private.check_company_payout_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare settlement_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[];
    component_total bigint; source_total numeric; fee_total numeric; company_total numeric;
    used_terms bigint; unresolved boolean; differs boolean; has_amounts boolean;
begin
    select coalesce(array_agg(version_id order by settlement_id),'{}'::uuid[])
        into settlement_versions from private.payout_report_settlement_versions where report_id = new.id;
    select coalesce(array_agg(version_id order by day_id),'{}'::uuid[])
        into kiosk_versions from private.payout_report_data_kiosk_versions where report_id = new.id;
    select coalesce(array_agg(terms_version_id order by seller_sku_id),'{}'::uuid[])
        into terms_versions from private.payout_report_terms_versions where report_id = new.id;
    if cardinality(settlement_versions) <> new.settlement_version_count
        or cardinality(kiosk_versions) <> new.data_kiosk_version_count
        or cardinality(terms_versions) <> new.terms_version_count then
        raise exception 'Incomplete payout input inventory' using errcode = '23514';
    end if;
    with resolved as materialized (
        select c.* from private.resolve_company_components(settlement_versions,kiosk_versions,terms_versions) c
        where (new.seller_namespace is null or c.seller_namespace = new.seller_namespace)
          and c.category <> 'SELBOX'
          and (c.authoritative or (c.source = 'DATA_KIOSK' and c.company_id is not null))
          and c.activity_date between new.start_date and new.end_date
    ), expected as (
        select to_jsonb(jsonb_populate_record(null::public.company_payout_report_components,to_jsonb(c)))
            - array['id','report_id','row_number'] as item
        from resolved c where c.company_id = new.company_id and c.currency = new.currency
    ), actual as (
        select to_jsonb(c) - array['id','report_id','row_number'] as item
        from public.company_payout_report_components c where c.report_id = new.id
    ), difference as (
        (select item from expected except all select item from actual)
        union all
        (select item from actual except all select item from expected)
    ) select
        (select count(distinct terms_version_id) from resolved),
        (select coalesce(bool_or(authoritative and company_id = new.company_id
            and (new.currency is null or currency = new.currency)),false) from resolved),
        (select coalesce(bool_or(authoritative and (company_id is null
            or (company_id = new.company_id and currency = new.currency
                and resolution_status not in ('APPLIED','NOT_APPLICABLE')))),false) from resolved),
        exists(select 1 from difference)
    into used_terms, has_amounts, unresolved, differs;
    perform private.assert_payout_source_versions(new.seller_namespace,new.start_date,new.end_date,
        new.preprocess_version,new.marketplace_names,new.dataset_key,settlement_versions,kiosk_versions,has_amounts);
    if (has_amounts and used_terms <> new.terms_version_count)
        or (new.currency is null and has_amounts) or unresolved or differs then
        raise exception 'Payout contents do not match complete frozen source and terms inputs' using errcode = '23514';
    end if;
    select count(*),coalesce(sum(source_amount) filter (where authoritative),0),
        coalesce(sum(fee_amount) filter (where authoritative),0),
        coalesce(sum(company_amount) filter (where authoritative),0)
        into component_total,source_total,fee_total,company_total
        from public.company_payout_report_components where report_id = new.id;
    if (component_total,source_total,fee_total,company_total) is distinct from
        (new.component_count::bigint,new.source_amount::numeric,new.fee_amount::numeric,new.company_amount::numeric) then
        raise exception 'Payout totals do not match its complete component inventory' using errcode = '23514';
    end if;
    with expected as (
        select to_jsonb(r) as item
        from private.resolve_source_reconciliation(settlement_versions,kiosk_versions) r
        where r.seller_namespace = new.seller_namespace
            and r.activity_date between new.start_date and new.end_date
    ), actual as (
        select to_jsonb(r) - array['report_id','row_number'] as item
        from private.payout_report_reconciliation r where r.report_id = new.id
    ), difference as (
        (select item from expected except all select item from actual)
        union all
        (select item from actual except all select item from expected)
    ) select exists(select 1 from difference) into differs;
    if differs or (select count(*) from private.payout_report_reconciliation where report_id = new.id)
        <> new.reconciliation_count then
        raise exception 'Payout reconciliation does not match its frozen source inputs' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_company_payout_report
after insert on public.company_payout_reports deferrable initially deferred
for each row execute function private.check_company_payout_report();
