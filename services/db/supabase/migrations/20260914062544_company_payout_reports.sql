-- Frozen entitlement reports. Publication does not approve or execute a payment.
-- Calculated amounts can exceed the individual source-value precision bounds.
create domain private.calculated_amount as numeric
check (value::text not in ('NaN', 'Infinity', '-Infinity'));

create table public.company_payout_reports (
    id public.local_uuid primary key default private.uuid7(),
    company_id public.local_uuid not null references public.companies (id),
    seller_namespace private.nonblank not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    preprocess_version private.nonblank not null,
    dataset_key text not null check (dataset_key = 'economics'),
    marketplace_names text[] not null check (
        array_position(marketplace_names, null) is null
        and marketplace_names <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
        ]::text[]
    ),
    report_name private.nonblank not null,
    change_reason private.nonblank not null,
    calculation_version text not null check (calculation_version = 'v0'),
    component_count integer not null check (component_count >= 0),
    settlement_version_count integer not null check (settlement_version_count >= 0),
    data_kiosk_version_count integer not null check (data_kiosk_version_count >= 0),
    terms_version_count integer not null check (terms_version_count >= 0),
    source_amount private.calculated_amount not null,
    fee_amount private.calculated_amount not null,
    company_amount private.calculated_amount not null,
    created_at timestamptz not null default now(),
    check (company_amount = source_amount + fee_amount)
);
-- Company lookup also supports FK checks when a company is changed or removed.
create index company_payout_reports_company_idx
on public.company_payout_reports (company_id);
create index company_payout_reports_created_idx
on public.company_payout_reports (created_at desc nulls last, id asc);

-- These complete manifests are also the retention pins. They include empty
-- source versions and ownership inputs used to exclude other companies' rows.
create table private.payout_report_settlement_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    settlement_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, settlement_id),
    unique (report_id, version_id),
    foreign key (settlement_id, version_id)
    references private.settlement_preprocess_versions (settlement_id, id)
);

create table private.payout_report_data_kiosk_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    day_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, day_id),
    unique (report_id, version_id),
    foreign key (day_id, version_id)
    references private.data_kiosk_preprocess_versions (day_id, id)
);
create index payout_data_kiosk_version_idx
on private.payout_report_data_kiosk_versions (version_id);

create table private.payout_report_terms_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    seller_sku_id public.local_uuid not null,
    terms_version_id public.local_uuid not null,
    primary key (report_id, seller_sku_id),
    unique (report_id, terms_version_id),
    foreign key (seller_sku_id, terms_version_id)
    references public.sku_terms_versions (seller_sku_id, id)
);

create table public.company_payout_report_components (
    id public.local_uuid primary key default private.uuid7(),
    report_id public.local_uuid not null references public.company_payout_reports (id),
    row_number integer not null check (row_number > 0),
    source text not null check (source in ('SETTLEMENT', 'DATA_KIOSK')), -- noqa: RF04
    source_row_id public.local_uuid not null,
    source_version_id public.local_uuid not null,
    source_identity_id public.local_uuid not null,
    seller_sku_id public.local_uuid not null,
    terms_version_id public.local_uuid not null,
    fee_period_id public.local_uuid,
    sku private.nonblank not null,
    marketplace_name text check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    )),
    activity_date date not null,
    component_type private.nonblank not null,
    source_amount private.calculated_amount not null,
    quantity private.calculated_amount,
    fee_base private.calculated_amount,
    fee_rate_percent private.calculated_amount,
    fee_amount private.calculated_amount not null,
    company_amount private.calculated_amount not null,
    resolution_status text not null check (resolution_status in ('APPLIED', 'NOT_APPLICABLE')),
    unique (report_id, row_number),
    unique (report_id, source, source_row_id),
    foreign key (report_id, terms_version_id)
    references private.payout_report_terms_versions (report_id, terms_version_id),
    foreign key (seller_sku_id, terms_version_id)
    references public.sku_terms_versions (seller_sku_id, id),
    foreign key (terms_version_id, fee_period_id)
    references public.sku_fee_periods (terms_version_id, id),
    check (company_amount = source_amount + fee_amount),
    check (
        (
            resolution_status = 'NOT_APPLICABLE' and fee_base is null
            and fee_period_id is null and fee_rate_percent is null and fee_amount = 0
        )
        or (
            resolution_status = 'APPLIED' and fee_base is not null
            and fee_period_id is not null and fee_rate_percent is not null
            and fee_rate_percent between 0 and 100
            and fee_amount = -(fee_base * fee_rate_percent * 0.01)
        )
    )
);

-- Reject payload loss even from trusted direct SQL, and serialize pins with
-- pruning using the same day locks. There is no independent pin/unpin API.
create trigger preserve_required_evidence
before insert on private.payout_report_data_kiosk_versions
for each row execute function private.guard_data_kiosk_retention();

do $$
declare relation text;
begin
    foreach relation in array array[
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_settlement_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions'
    ] loop
        execute format('alter table %s enable row level security', relation);
        execute format('revoke all on %s from public, anon, authenticated, service_role', relation);
        execute format('create trigger immutable before update or delete on %s for each row execute function private.reject_mutation()', relation);
        execute format('create trigger immutable_truncate before truncate on %s for each statement execute function private.reject_mutation()', relation);
    end loop;
end;
$$;

-- Counts describe immutable inventories, not user-entered business terms.
do $$
declare child text; count_field text;
begin
    for child, count_field in values
        ('public.company_payout_report_components', 'component_count'),
        ('private.payout_report_settlement_versions', 'settlement_version_count'),
        ('private.payout_report_data_kiosk_versions', 'data_kiosk_version_count'),
        ('private.payout_report_terms_versions', 'terms_version_count')
    loop
        execute format(
            'create trigger complete_report_insert after insert on %s referencing new table as inserted_children for each statement execute function private.guard_child_inventory(%L,%L,%L)',
            child, 'public.company_payout_reports', count_field, 'report_id');
    end loop;
end;
$$;

create function private.assert_payout_source_versions(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_marketplaces text[], p_dataset_key text,
    p_settlement_versions uuid[], p_data_kiosk_versions uuid[]
) returns void language plpgsql set search_path = '' as $$
begin
    if p_settlement_versions is null or p_data_kiosk_versions is null
        or p_marketplaces is null or p_dataset_key is distinct from 'economics'
        or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
        or p_end < p_start or nullif(btrim(p_seller_namespace),'') is null
        or nullif(btrim(p_preprocess_version),'') is null
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
        where v.id is null or s.seller_namespace <> p_seller_namespace
            or v.preprocess_version <> p_preprocess_version
    ) or (select count(distinct settlement_id) from private.settlement_preprocess_versions
          where id = any(p_settlement_versions)) <> cardinality(p_settlement_versions) then
        raise exception 'Missing, duplicate or incompatible payout Settlement version' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_data_kiosk_versions) requested(id)
        left join private.data_kiosk_preprocess_versions v on v.id = requested.id
        left join private.data_kiosk_days d on d.id = v.day_id
        where v.id is null or v.preprocess_version <> p_preprocess_version
            or d.seller_namespace <> p_seller_namespace or d.dataset_key <> p_dataset_key
            or d.activity_date not between p_start and p_end
            or not (d.marketplace_name = any(p_marketplaces))
            or exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = v.id)
    ) or (select count(distinct day_id) from private.data_kiosk_preprocess_versions
          where id = any(p_data_kiosk_versions)) <> cardinality(p_data_kiosk_versions)
      or cardinality(p_data_kiosk_versions)::bigint <> cardinality(p_marketplaces)::bigint * (p_end - p_start + 1)
    then
        raise exception 'Incomplete, pruned or incompatible payout Data Kiosk coverage' using errcode = '23514';
    end if;
end;
$$;

-- Verify completed reports against their immutable manifests, never live pointers.
-- This also validates polymorphic component provenance against typed source pins.
create function private.check_company_payout_report() returns trigger
language plpgsql set search_path = '' as $$
declare settlement_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[];
    component_total bigint; source_total numeric; fee_total numeric; company_total numeric;
    used_terms bigint; unresolved boolean; differs boolean;
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
    perform private.assert_payout_source_versions(new.seller_namespace,new.start_date,new.end_date,
        new.preprocess_version,new.marketplace_names,new.dataset_key,settlement_versions,kiosk_versions);
    with resolved as materialized (
        select c.* from private.resolve_company_components(settlement_versions,kiosk_versions,terms_versions) c
        where c.seller_namespace = new.seller_namespace and c.authoritative
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
        (select coalesce(bool_or(resolution_status not in ('APPLIED','NOT_APPLICABLE')),false) from resolved),
        exists(select 1 from difference)
    into used_terms, unresolved, differs;
    if used_terms <> new.terms_version_count or unresolved or differs then
        raise exception 'Payout contents do not match complete frozen source and terms inputs' using errcode = '23514';
    end if;
    select count(*),coalesce(sum(source_amount),0),coalesce(sum(fee_amount),0),coalesce(sum(company_amount),0)
        into component_total,source_total,fee_total,company_total
        from public.company_payout_report_components where report_id = new.id;
    if (component_total,source_total,fee_total,company_total) is distinct from
        (new.component_count::bigint,new.source_amount::numeric,new.fee_amount::numeric,new.company_amount::numeric) then
        raise exception 'Payout totals do not match its complete component inventory' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_company_payout_report
after insert on public.company_payout_reports deferrable initially deferred
for each row execute function private.check_company_payout_report();

create function private.publish_company_payout_report(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare report_input public.company_payout_reports; settlement_ids uuid[];
    settlement_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[]; used_terms uuid[];
    locked_identity record; locked_day_ids uuid[] := '{}';
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
        or report_input.currency is null or report_input.currency !~ '^[A-Z]{3}$'
        or report_input.marketplace_names is null
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
    -- Every publisher uses day natural order. Capture only after obtaining locks;
    -- READ COMMITTED then observes pruning/source publications that finished first.
    for locked_identity in
        select d.id from private.data_kiosk_days d
        where d.seller_namespace = report_input.seller_namespace
          and d.marketplace_name = any(report_input.marketplace_names)
          and d.activity_date between report_input.start_date and report_input.end_date
          and d.dataset_key = report_input.dataset_key
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key
    loop
        perform 1 from private.data_kiosk_days where id = locked_identity.id for update;
        locked_day_ids := array_append(locked_day_ids,locked_identity.id);
    end loop;
    if cardinality(locked_day_ids)::bigint is distinct from
        cardinality(report_input.marketplace_names)::bigint * (report_input.end_date - report_input.start_date + 1) then
        raise exception 'Missing required payout Data Kiosk day identity' using errcode = '23514';
    end if;
    for locked_identity in
        select s.id from private.settlements s where s.id = any(settlement_ids)
        order by s.seller_namespace,s.amazon_scope,s.settlement_id
    loop
        perform 1 from private.settlements where id = locked_identity.id for update;
    end loop;
    -- One snapshot captures all selections; the remaining calculation and all
    -- manifest rows use these exact UUIDs. Fee publications need no source locks.
    select
        (select coalesce(array_agg(s.current_version_id order by s.id),'{}'::uuid[])
         from private.settlements s where s.id = any(settlement_ids)),
        (select coalesce(array_agg(d.current_version_id order by d.id),'{}'::uuid[])
         from private.data_kiosk_days d where d.id = any(locked_day_ids)),
        (select coalesce(array_agg(s.current_terms_version_id order by s.id),'{}'::uuid[])
         from public.seller_skus s where s.seller_namespace = report_input.seller_namespace)
    into settlement_versions,kiosk_versions,terms_versions;
    if cardinality(settlement_versions) <> cardinality(settlement_ids) then
        raise exception 'Missing required payout Settlement identity' using errcode = '23514';
    end if;
    perform private.assert_payout_source_versions(report_input.seller_namespace,report_input.start_date,
        report_input.end_date,report_input.preprocess_version,report_input.marketplace_names,
        report_input.dataset_key,settlement_versions,kiosk_versions);
    create temporary table if not exists payout_resolved_components on commit drop as
        select c.* from private.resolve_company_components('{}'::uuid[],'{}'::uuid[],'{}'::uuid[]) c
        with no data;
    truncate pg_temp.payout_resolved_components;
    insert into pg_temp.payout_resolved_components
        select c.* from private.resolve_company_components(settlement_versions,kiosk_versions,terms_versions) c
        where c.seller_namespace = report_input.seller_namespace and c.authoritative
          and c.activity_date between report_input.start_date and report_input.end_date;
    if exists (select 1 from pg_temp.payout_resolved_components
               where resolution_status not in ('APPLIED','NOT_APPLICABLE')) then
        raise exception 'Unresolved ownership or fee coverage prevents a complete payout report' using errcode = '23514';
    end if;
    select coalesce(array_agg(distinct terms_version_id),'{}'::uuid[]) into used_terms
        from pg_temp.payout_resolved_components;
    insert into public.company_payout_reports (
        id,company_id,seller_namespace,currency,start_date,end_date,preprocess_version,dataset_key,
        marketplace_names,report_name,change_reason,calculation_version,component_count,
        settlement_version_count,data_kiosk_version_count,terms_version_count,
        source_amount,fee_amount,company_amount
    ) select report_input.id,report_input.company_id,report_input.seller_namespace,report_input.currency,
        report_input.start_date,report_input.end_date,report_input.preprocess_version,report_input.dataset_key,
        report_input.marketplace_names,report_input.report_name,report_input.change_reason,'v0',
        count(*)::integer,cardinality(settlement_versions),cardinality(kiosk_versions),cardinality(used_terms),
        coalesce(sum(source_amount),0),coalesce(sum(fee_amount),0),coalesce(sum(company_amount),0)
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
        report_id,row_number,source,source_row_id,source_version_id,source_identity_id,
        seller_sku_id,terms_version_id,fee_period_id,sku,marketplace_name,activity_date,component_type,
        source_amount,quantity,fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
    ) select report_input.id,
        row_number() over(order by source,source_identity_id,source_row_id)::integer,
        source,source_row_id,source_version_id,source_identity_id,seller_sku_id,terms_version_id,
        fee_period_id,sku,marketplace_name,activity_date,component_type,source_amount,quantity,
        fee_base,fee_rate_percent,fee_amount,company_amount,resolution_status
        from pg_temp.payout_resolved_components
        where company_id = report_input.company_id and currency = report_input.currency;
    return report_input.id;
end;
$$;

revoke all on function private.assert_payout_source_versions(
    text, date, date, text, text[], text, uuid[], uuid[]
) from public,
anon,
authenticated,
service_role;
revoke all on function private.check_company_payout_report() from public,
anon,
authenticated,
service_role;
revoke all on function private.publish_company_payout_report(jsonb) from public,
anon,
authenticated,
service_role;
