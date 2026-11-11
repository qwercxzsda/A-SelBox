-- Payouts pin immutable source revisions; successful preprocessing establishes
-- retrieval coverage and compatible interpretation before report publication.
-- noqa: disable=AM04
create function private.payout_company_eligible(p_company_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
    select exists (
        select 1 from private.current_sku_terms t where t.company_id = p_company_id
    );
$$;

create function private.payout_month_end(p_month date) returns date
language plpgsql stable security invoker set search_path = '' as $$
declare month_end date;
begin
    if p_month is null or not isfinite(p_month)
        or p_month <> date_trunc('month', p_month)::date then
        raise exception 'Choose the first day of a calendar month' using errcode = '22023';
    end if;
    month_end := (p_month + interval '1 month - 1 day')::date;
    if month_end >= private.mature_cutoff_date() then
        raise exception 'The selected month is not yet eligible for a payout report' using errcode = '22023';
    end if;
    return month_end;
end;
$$;

-- Historical source identities remain available even after ownership changes.
create function private.payout_company_sellers(p_company_id uuid) returns text[]
language sql stable set search_path = '' as $$
    with company_skus as materialized (
        select s.sku from public.skus s
        where exists (
            select 1 from public.sku_terms_versions v
            where v.sku_id = s.id and v.company_id = p_company_id
        )
    )
    select coalesce(array_agg(seller_namespace order by seller_namespace), '{}'::text[])
    from (
        select t.seller_namespace::text from company_skus s
        join private.finances_activity_components t on t.sku = s.sku
        union
        select t.seller_namespace::text from company_skus s
        join private.data_kiosk_component_details t on t.sku = s.sku
        union
        select t.seller_namespace::text from public.company_payout_reports r
        join private.payout_report_finances_versions p on p.report_id = r.id
        join private.finances_transactions t on t.id = p.transaction_id
        where r.company_id = p_company_id
        union
        select d.seller_namespace::text from public.company_payout_reports r
        join private.payout_report_data_kiosk_versions p on p.report_id = r.id
        join private.data_kiosk_days d on d.id = p.day_id where r.company_id = p_company_id
    ) sellers;
$$;

-- Choose successful coverage at creation time; these observation labels are not
-- stored as report identity. Only independently reconciled days whose observed
-- versions still match the current marketplace can supply Finance coverage.
-- Unchanged versions can reuse older proof after an unreconciled refresh, and
-- empty reconciled captures still supply coverage for genuinely empty days.
create function private.current_payout_source_days(
    p_sellers text[], p_start date, p_end date, p_marketplace text
) returns table (
    source text, seller_namespace text, marketplace_name text,
    activity_date date, preprocess_version text
) language sql stable security invoker set search_path = '' as $$
    select 'FINANCES'::text,seller_namespace,marketplace_name,activity_date,preprocess_version
    from private.current_finances_reconciled_days(p_sellers,p_start,p_end,p_marketplace)
    union all
    select 'DATA_KIOSK',d.seller_namespace::text,d.marketplace_name,d.activity_date,b.preprocess_version::text
    from private.data_kiosk_days d
    join private.data_kiosk_preprocess_batches b on b.id=d.current_batch_id
    where d.seller_namespace=any(p_sellers) and d.dataset_key='economics'
        and d.current_version_id is not null and d.activity_date between p_start and p_end
        and (p_marketplace is null or d.marketplace_name in (
            p_marketplace,private.finances_data_kiosk_marketplace(p_marketplace)))
$$;

create function private.canonical_payout_coverage(p_value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; first_day date; last_day date; result jsonb;
begin
    if p_value is null or jsonb_typeof(p_value)<>'array' then
        raise exception 'Payout coverage must be an interval array' using errcode='23514';
    end if;
    for item in select value from jsonb_array_elements(p_value) loop
        if jsonb_typeof(item)<>'object'
            or not item ?& array['source','seller_namespace','marketplace_name','start_date','end_date']
            or exists(select 1 from jsonb_object_keys(item) key where key<>all(
                array['source','seller_namespace','marketplace_name','start_date','end_date']))
            or exists(select 1 from jsonb_each(item) field where jsonb_typeof(field.value)<>'string')
            or item->>'source' not in ('FINANCES','DATA_KIOSK')
            or nullif(btrim(item->>'seller_namespace'),'') is null
            or nullif(btrim(item->>'marketplace_name'),'') is null
            or item->>'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            or item->>'end_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
            raise exception 'Invalid payout coverage interval' using errcode='23514';
        end if;
        first_day:=(item->>'start_date')::date; last_day:=(item->>'end_date')::date;
        if not isfinite(first_day) or not isfinite(last_day) or first_day>last_day then
            raise exception 'Invalid payout coverage dates' using errcode='23514';
        end if;
    end loop;
    with ranges as (
        select value->>'source' as source,value->>'seller_namespace' as seller_namespace,
            value->>'marketplace_name' as marketplace_name,
            range_agg(daterange((value->>'start_date')::date,(value->>'end_date')::date+1,'[)')) as periods
        from jsonb_array_elements(p_value) group by 1,2,3
    ), intervals as (
        select r.source,r.seller_namespace,r.marketplace_name,lower(period) as start_date,
            upper(period)-1 as end_date from ranges r cross join lateral unnest(r.periods) period
    )
    select coalesce(jsonb_agg(to_jsonb(i) order by i.source,i.seller_namespace,i.marketplace_name,
        i.start_date,i.end_date),'[]'::jsonb) into result from intervals i;
    return result;
end;
$$;

-- Capture and validate the same successful source days once at publication.
-- Mixed current revisions from overlapping captures remain valid; their labels
-- must agree with the coverage evidence before it becomes immutable metadata.
create function private.payout_source_coverage(
    p_sellers text[], p_start date, p_end date, p_marketplace text,
    p_finances_versions uuid[], p_require_complete boolean
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare incompatible boolean; incomplete boolean; coverage jsonb;
begin
    with covered as materialized (
        select * from private.current_payout_source_days(p_sellers,p_start,p_end,p_marketplace)
    ), labels as (
        select t.seller_namespace::text,b.preprocess_version::text
        from private.finances_transactions t
        join private.finances_preprocess_batches b on b.id=t.current_batch_id
        where t.current_version_id=any(p_finances_versions)
        union all
        select d.seller_namespace,d.preprocess_version from covered d
    ), required_sellers as (
        select d.seller_namespace::text from private.data_kiosk_days d
        where d.seller_namespace=any(p_sellers) and d.dataset_key='economics'
            and d.marketplace_name in (p_marketplace,private.finances_data_kiosk_marketplace(p_marketplace))
        union
        select a.seller_namespace::text from private.finances_acquisitions a
        where a.seller_namespace=any(p_sellers)
            and exists(select 1 from private.finances_preprocess_batches b where b.acquisition_id=a.id)
            and exists(select 1 from jsonb_array_elements(a.api_metadata->'coverage_marketplaces') market
                where market->>'marketplace_name'=p_marketplace)
    ) select exists (
        select 1 from labels group by seller_namespace having count(distinct preprocess_version)>1
    ), p_require_complete and exists (
        select 1 from required_sellers s
        cross join (values ('FINANCES',p_marketplace),
            ('DATA_KIOSK',private.finances_data_kiosk_marketplace(p_marketplace))) source_scope(source,marketplace)
        where not exists(select 1 from covered c where c.seller_namespace=s.seller_namespace
            and c.source=source_scope.source and c.marketplace_name=source_scope.marketplace
            group by c.seller_namespace having count(*)=p_end-p_start+1)
    ), (
        select private.canonical_payout_coverage(coalesce(jsonb_agg(jsonb_build_object(
            'source',d.source,'seller_namespace',d.seller_namespace,'marketplace_name',d.marketplace_name,
            'start_date',d.activity_date,'end_date',d.activity_date)),'[]'::jsonb))
        from covered d where p_marketplace is not null
    ) into incompatible,incomplete,coverage;
    if incompatible then
        raise exception 'Source preprocessing versions must agree within each namespace for a monthly payout'
            using errcode='23514', detail='SOURCE_REQUIRED';
    end if;
    if incomplete then
        raise exception 'Complete successful source coverage is required for payout'
            using errcode='23514', detail='SOURCE_REQUIRED';
    end if;
    return coverage;
end;
$$;

-- Frozen validity uses only the report's declared interval evidence and immutable
-- versions, never later pointers, observation labels, or acquisition history.
-- The resolver checks identity conflicts; manifest keys enforce unique pins.
create function private.assert_payout_sources(
    p_report public.company_payout_reports,
    p_finances_versions uuid[], p_data_kiosk_versions uuid[], p_require_complete boolean
) returns void language plpgsql stable security invoker set search_path = '' as $$
begin
    if p_require_complete is null or (p_report).dataset_key is distinct from 'economics'
        or (p_report).source_coverage is distinct from private.canonical_payout_coverage((p_report).source_coverage)
        or ((p_report).marketplace_name is null and (p_report).source_coverage<>'[]'::jsonb) then
        raise exception 'Explicit valid payout revision scope required' using errcode='23514';
    end if;
    if exists (
        select 1 from unnest(p_finances_versions) requested(id)
        left join private.finances_transaction_versions v on v.id=requested.id
        where v.id is null or v.posted_date not between (p_report).start_date and (p_report).end_date
            or ((p_report).marketplace_name is not null and v.marketplace_name<>(p_report).marketplace_name)
    ) then raise exception 'Invalid payout Finance revision scope' using errcode='23514'; end if;
    if exists (
        select 1 from unnest(p_data_kiosk_versions) requested(id)
        left join private.data_kiosk_day_versions v on v.id=requested.id
        left join private.data_kiosk_days d on d.id=v.day_id
        where v.id is null or d.dataset_key<>(p_report).dataset_key
            or d.activity_date not between (p_report).start_date and (p_report).end_date
            or ((p_report).marketplace_name is not null and d.marketplace_name not in (
                (p_report).marketplace_name,private.finances_data_kiosk_marketplace((p_report).marketplace_name)))
    ) then raise exception 'Invalid payout Data Kiosk revision scope' using errcode='23514'; end if;
    if exists (
        select 1 from jsonb_array_elements((p_report).source_coverage) c
        where (c->>'start_date')::date<(p_report).start_date or (c->>'end_date')::date>(p_report).end_date
            or c->>'marketplace_name' is distinct from case when c->>'source'='FINANCES'
                then (p_report).marketplace_name else private.finances_data_kiosk_marketplace((p_report).marketplace_name) end
    ) then raise exception 'Payout coverage differs from its saved scope' using errcode='23514'; end if;
    if p_require_complete and exists (
        with sellers as (
            select t.seller_namespace::text from private.finances_transaction_versions v
            join private.finances_transactions t on t.id=v.transaction_id where v.id=any(p_finances_versions)
            union
            select d.seller_namespace::text from private.data_kiosk_day_versions v
            join private.data_kiosk_days d on d.id=v.day_id where v.id=any(p_data_kiosk_versions)
            union
            select c->>'seller_namespace' from jsonb_array_elements((p_report).source_coverage) c
        )
        select 1 from sellers s
        cross join (values ('FINANCES'),('DATA_KIOSK')) source_scope(source)
        where not exists(select 1 from jsonb_array_elements((p_report).source_coverage) c
            where c->>'source'=source_scope.source and c->>'seller_namespace'=s.seller_namespace
                and (c->>'start_date')::date=(p_report).start_date
                and (c->>'end_date')::date=(p_report).end_date)
            or (source_scope.source='DATA_KIOSK' and (
                select count(*) from private.data_kiosk_day_versions v
                join private.data_kiosk_days d on d.id=v.day_id
                where v.id=any(p_data_kiosk_versions) and d.seller_namespace=s.seller_namespace
                    and d.marketplace_name=private.finances_data_kiosk_marketplace((p_report).marketplace_name)
            )<>(p_report).end_date-(p_report).start_date+1)
    ) then raise exception 'Incomplete frozen payout source coverage' using errcode='23514'; end if;
end;
$$;

-- Publication and deferred integrity use the same relational calculation.
-- Source interpretation is already frozen in the selected normalized versions.
create function private.payout_report_aggregate(
    p_report public.company_payout_reports,
    p_finances_versions uuid[], p_data_kiosk_versions uuid[], p_terms_versions uuid[]
) returns table (
    has_amounts boolean, unresolved boolean, terms_version_ids uuid[], component_count bigint,
    source_amount numeric, fee_amount numeric, company_amount numeric
) language sql stable security invoker set search_path = '' as $$
    with resolved as materialized (
        select c.* from private.resolve_company_components(
            p_finances_versions,p_data_kiosk_versions,p_terms_versions) c
        where c.category <> 'SELBOX'
            and (c.authoritative or (c.source = 'DATA_KIOSK' and c.company_id is not null))
            and c.activity_date between (p_report).start_date and (p_report).end_date
    ), scoped as (
        select c.* from resolved c
        where c.company_id = (p_report).company_id and c.currency = (p_report).currency
            and c.marketplace_name is not distinct from (p_report).marketplace_name
    ) select
        exists(select 1 from resolved where authoritative and company_id = (p_report).company_id
            and marketplace_name is not distinct from (p_report).marketplace_name
            and ((p_report).currency is null or currency = (p_report).currency)),
        exists(select 1 from resolved where authoritative and (company_id is null
            or (company_id = (p_report).company_id and currency = (p_report).currency
                and marketplace_name is not distinct from (p_report).marketplace_name
                and resolution_status not in ('APPLIED','NOT_APPLICABLE')))),
        (select coalesce(array_agg(distinct terms_version_id order by terms_version_id)
            filter (where terms_version_id is not null),'{}'::uuid[]) from resolved),
        count(*),coalesce(sum(source_amount) filter (where authoritative),0),
        coalesce(sum(fee_amount) filter (where authoritative),0),
        coalesce(sum(company_amount) filter (where authoritative),0)
    from scoped;
$$;

-- Recalculate aggregate amounts and detail counts from immutable input manifests.
-- Reports store no component copies; later reads use the same fixed calculation.
-- Deferred checks validate private evidence as owner, independently of the
-- publication caller. The trigger does not expose a callable application API.
create function private.check_company_payout_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare finances_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[];
    aggregate record;
begin
    select coalesce(array_agg(version_id order by transaction_id),'{}'::uuid[])
        into finances_versions from private.payout_report_finances_versions where report_id = new.id;
    select coalesce(array_agg(version_id order by day_id),'{}'::uuid[])
        into kiosk_versions from private.payout_report_data_kiosk_versions where report_id = new.id;
    select coalesce(array_agg(terms_version_id order by sku_id),'{}'::uuid[])
        into terms_versions from private.payout_report_terms_versions where report_id = new.id;
    if cardinality(finances_versions) <> new.finances_version_count
        or cardinality(kiosk_versions) <> new.data_kiosk_version_count
        or cardinality(terms_versions) <> new.terms_version_count then
        raise exception 'Incomplete payout input inventory' using errcode = '23514';
    end if;
    select * into aggregate from private.payout_report_aggregate(
        new,finances_versions,kiosk_versions,terms_versions);
    perform private.assert_payout_sources(new,finances_versions,kiosk_versions,aggregate.has_amounts);
    if (aggregate.has_amounts and cardinality(aggregate.terms_version_ids) <> new.terms_version_count)
        or (new.currency is null and aggregate.has_amounts) or aggregate.unresolved then
        raise exception 'Payout contents do not match complete frozen source and terms inputs' using errcode = '23514';
    end if;
    if (aggregate.component_count,aggregate.source_amount,aggregate.fee_amount,aggregate.company_amount) is distinct from
        (new.component_count::bigint,new.source_amount::numeric,new.fee_amount::numeric,new.company_amount::numeric) then
        raise exception 'Payout totals or detail count differ from frozen inputs' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_company_payout_report
after insert on public.company_payout_reports deferrable initially deferred
for each row execute function private.check_company_payout_report();
