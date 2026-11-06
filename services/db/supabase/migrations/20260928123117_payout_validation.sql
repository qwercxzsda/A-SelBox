-- Payout selection uses successful preprocessing runs; financial validation is
-- performed by preprocessing before those immutable runs are published.
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
        select a.seller_namespace::text from public.company_payout_reports r
        join private.payout_report_finances_batches p on p.report_id = r.id
        join private.finances_preprocess_batches f on f.id = p.batch_id
        join private.finances_acquisitions a on a.id = f.acquisition_id
        where r.company_id = p_company_id
        union
        select d.seller_namespace::text from public.company_payout_reports r
        join private.payout_report_data_kiosk_observations p on p.report_id = r.id
        join private.data_kiosk_days d on d.id = p.day_id where r.company_id = p_company_id
    ) sellers;
$$;

-- Compare membership rather than observation timestamps: unchanged revisions
-- can be shared by several successful runs. This is a current-input selection
-- guard, never another component/Summary financial validation.
create function private.finances_batch_matches_current(p_batch_id uuid, p_start date, p_end date)
returns boolean language sql stable security invoker set search_path = '' as $$
    select exists (
        select 1 from private.finances_preprocess_batches p
        join private.finances_acquisitions a on a.id = p.acquisition_id
        where p.id = p_batch_id and a.query_start_date <= p_start and a.query_end_date >= p_end
            and not exists (
                select 1 from private.finances_preprocess_batch_transactions m
                join private.finances_transaction_versions r on r.id = m.version_id
                join private.finances_transactions t on t.id = m.transaction_id
                where m.batch_id = p.id and r.posted_date between p_start and p_end
                    and t.current_version_id is distinct from m.version_id
            )
            and not exists (
                select 1 from private.finances_transactions t
                join private.finances_transaction_versions r on r.id = t.current_version_id
                where t.seller_namespace = a.seller_namespace and t.amazon_scope = a.amazon_scope
                    and r.marketplace_id = any(a.marketplace_ids)
                    and r.posted_date between p_start and p_end
                    and not exists (
                        select 1 from private.finances_preprocess_batch_transactions m
                        where m.batch_id = p.id and m.transaction_id = t.id
                            and m.version_id = t.current_version_id
                    )
            )
    );
$$;

-- Select one complete observation for each seller/marketplace scope, including
-- empty captures. A shared regional batch is checked once even when it covers
-- several marketplaces. Keep the order of each batch's first covered scope.
create function private.payout_finances_batch_ids(p_sellers text[], p_start date, p_end date)
returns uuid[] language plpgsql stable security invoker set search_path = '' as $$
declare selected_batches uuid[];
begin
    with scopes as (
        select distinct a.seller_namespace, a.amazon_scope, marketplace_id
        from private.finances_preprocess_batches p
        join private.finances_acquisitions a on a.id = p.acquisition_id
        cross join lateral unnest(a.marketplace_ids) marketplace_id
        where a.seller_namespace = any(p_sellers)
            and a.query_start_date <= p_end and a.query_end_date >= p_start
    ), selected as (
        select row_number() over (
            order by s.seller_namespace, s.amazon_scope, s.marketplace_id
        ) as scope_order, (
            select p.id
            from private.finances_preprocess_batches p
            join private.finances_acquisitions a on a.id = p.acquisition_id
            where a.seller_namespace = s.seller_namespace and a.amazon_scope = s.amazon_scope
                and s.marketplace_id = any(a.marketplace_ids)
                and a.query_start_date <= p_start and a.query_end_date >= p_end
            order by a.capture_started_at desc, a.id desc, p.created_at desc, p.id desc
            limit 1
        ) as batch_id
        from scopes s
    ), batches as (
        select batch_id, min(scope_order) as first_scope from selected group by batch_id
    )
    select coalesce(array_agg(batch_id order by first_scope), '{}'::uuid[])
    into selected_batches from batches;
    if array_position(selected_batches, null) is not null or exists (
        select 1 from unnest(selected_batches) batch(id)
        where not private.finances_batch_matches_current(batch.id, p_start, p_end)
    ) then
        raise exception 'Complete current Finances preprocessing coverage is required for payout'
            using errcode = '23514';
    end if;
    return selected_batches;
end;
$$;

-- Frozen inputs are validated only against immutable run/coverage identities.
-- Never consult current transaction pointers when checking an existing report.
create function private.assert_payout_sources(
    p_start date, p_end date, p_dataset_key text,
    p_finances_runs uuid[], p_data_kiosk_observation_ids uuid[],
    p_require_complete boolean, p_seller_namespaces text[] default null
) returns void language plpgsql set search_path = '' as $$
begin
    if p_finances_runs is null or p_data_kiosk_observation_ids is null
        or p_dataset_key is distinct from 'economics'
        or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
        or p_end < p_start or p_require_complete is null
        or array_position(p_finances_runs, null) is not null
        or array_position(p_data_kiosk_observation_ids, null) is not null
        or (select count(distinct value) from unnest(p_finances_runs) value) <> cardinality(p_finances_runs)
        or (select count(distinct value) from unnest(p_data_kiosk_observation_ids) value) <> cardinality(p_data_kiosk_observation_ids) then
        raise exception 'Explicit valid payout source scope required' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_finances_runs) requested(id)
        left join private.finances_preprocess_batches p on p.id = requested.id
        left join private.finances_acquisitions a on a.id = p.acquisition_id
        where p.id is null or a.query_start_date > p_start or a.query_end_date < p_end
    ) then
        raise exception 'Missing, duplicate or incomplete payout Finances run coverage' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_data_kiosk_observation_ids) requested(id)
        left join private.data_kiosk_preprocess_batch_days m on m.id = requested.id
        left join private.data_kiosk_days d on d.id = m.day_id
        where m.id is null or d.dataset_key <> p_dataset_key
            or d.activity_date not between p_start and p_end
    ) or (select count(distinct day_id) from private.data_kiosk_preprocess_batch_days
          where id = any(p_data_kiosk_observation_ids)) <> cardinality(p_data_kiosk_observation_ids) then
        raise exception 'Incomplete or incompatible payout Data Kiosk coverage' using errcode = '23514';
    end if;
    if p_require_complete and exists (
        with sellers as (
            select a.seller_namespace from private.finances_preprocess_batches p
            join private.finances_acquisitions a on a.id = p.acquisition_id
            where p.id = any(p_finances_runs)
            union
            select d.seller_namespace from private.data_kiosk_preprocess_batch_days m
            join private.data_kiosk_days d on d.id = m.day_id where m.id = any(p_data_kiosk_observation_ids)
            union
            select unnest(p_seller_namespaces)
        ), scopes as (
            select d.seller_namespace, d.marketplace_name from private.data_kiosk_days d
            where d.seller_namespace in (select seller_namespace from sellers) and d.dataset_key = p_dataset_key
            union
            select t.seller_namespace, private.finances_data_kiosk_marketplace(t.marketplace_name)
            from private.finances_batch_components t
            where t.batch_id = any(p_finances_runs) and t.activity_eligible
                and t.posted_date between p_start and p_end
        )
        select 1 from scopes s cross join generate_series(0, p_end-p_start) day_offset
        where not exists (
            select 1 from private.data_kiosk_preprocess_batch_days m
            join private.data_kiosk_days d on d.id = m.day_id
            where m.id = any(p_data_kiosk_observation_ids) and d.seller_namespace = s.seller_namespace
                and d.marketplace_name = s.marketplace_name and d.activity_date = p_start + day_offset
                and d.dataset_key = p_dataset_key
        )
    ) then
        raise exception 'Incomplete or incompatible payout Data Kiosk coverage' using errcode = '23514';
    end if;
    if p_require_complete and exists (
        select 1 from private.data_kiosk_preprocess_batch_days m
        join private.data_kiosk_days kd on kd.id = m.day_id
        where m.id = any(p_data_kiosk_observation_ids) and not exists (
            select 1 from private.finances_preprocess_batches p
            join private.finances_acquisitions a on a.id = p.acquisition_id
            cross join lateral jsonb_array_elements(a.api_metadata->'coverage_marketplaces') m
            where p.id = any(p_finances_runs) and a.seller_namespace = kd.seller_namespace
                and private.finances_data_kiosk_marketplace(m->>'marketplace_name') = kd.marketplace_name
                and kd.activity_date between a.query_start_date and a.query_end_date
        )
    ) then
        raise exception 'Complete Finances preprocessing coverage is required for payout' using errcode = '23514';
    end if;
    if exists (
        select 1 from (
            select a.seller_namespace, p.preprocess_version
            from private.finances_preprocess_batches p
            join private.finances_acquisitions a on a.id = p.acquisition_id
            where p.id = any(p_finances_runs)
            union all
            select d.seller_namespace, b.preprocess_version
            from private.data_kiosk_preprocess_batch_days m
            join private.data_kiosk_preprocess_batches b on b.id=m.batch_id
            join private.data_kiosk_days d on d.id = m.day_id where m.id = any(p_data_kiosk_observation_ids)
        ) versions group by seller_namespace having count(distinct preprocess_version) > 1
    ) then
        raise exception 'Source preprocessing versions must agree within each namespace for a monthly payout'
            using errcode = '23514';
    end if;
end;
$$;

-- Verify completed reports against their immutable manifests, never live pointers.
-- This also validates polymorphic component provenance against typed source pins.
-- Deferred checks validate private evidence as owner, independently of the
-- publication caller. The trigger does not expose a callable application API.
create function private.check_company_payout_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare finances_runs uuid[]; kiosk_observations uuid[]; terms_versions uuid[];
    component_total bigint; source_total numeric; fee_total numeric; company_total numeric;
    used_terms bigint; unresolved boolean; differs boolean; has_amounts boolean;
begin
    select coalesce(array_agg(batch_id order by batch_id),'{}'::uuid[])
        into finances_runs from private.payout_report_finances_batches where report_id = new.id;
    select coalesce(array_agg(m.id order by p.day_id),'{}'::uuid[])
        into kiosk_observations from private.payout_report_data_kiosk_observations p
        join private.data_kiosk_preprocess_batch_days m
            on (m.batch_id,m.day_id,m.version_id)=(p.batch_id,p.day_id,p.version_id)
        where p.report_id = new.id;
    select coalesce(array_agg(terms_version_id order by sku_id),'{}'::uuid[])
        into terms_versions from private.payout_report_terms_versions where report_id = new.id;
    if cardinality(finances_runs) <> new.finances_batch_count
        or cardinality(kiosk_observations) <> new.data_kiosk_observation_count
        or cardinality(terms_versions) <> new.terms_version_count then
        raise exception 'Incomplete payout input inventory' using errcode = '23514';
    end if;
    with resolved as materialized (
        select c.* from private.resolve_company_components(finances_runs,kiosk_observations,terms_versions) c
        where c.category <> 'SELBOX'
          and (c.authoritative or (c.source = 'DATA_KIOSK' and c.company_id is not null))
          and c.activity_date between new.start_date and new.end_date
    ), expected as (
        select to_jsonb(jsonb_populate_record(null::public.company_payout_report_components,to_jsonb(c)))
            - array['id','report_id','row_number'] as item
        from resolved c where c.company_id = new.company_id and c.currency = new.currency
            and c.marketplace_name is not distinct from new.marketplace_name
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
            and marketplace_name is not distinct from new.marketplace_name
            and (new.currency is null or currency = new.currency)),false) from resolved),
        (select coalesce(bool_or(authoritative and (company_id is null
            or (company_id = new.company_id and currency = new.currency
                and marketplace_name is not distinct from new.marketplace_name
                and resolution_status not in ('APPLIED','NOT_APPLICABLE')))),false) from resolved),
        exists(select 1 from difference)
    into used_terms, has_amounts, unresolved, differs;
    perform private.assert_payout_sources(new.start_date,new.end_date,
        new.dataset_key,finances_runs,kiosk_observations,has_amounts);
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
        from private.resolve_source_reconciliation(finances_runs,kiosk_observations) r
        where new.currency is not null and r.activity_date between new.start_date and new.end_date
            and r.marketplace_name is not distinct from new.marketplace_name
            and r.currency = new.currency
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
