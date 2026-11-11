-- A complete financial request declares all required successful Finances runs and
-- marketplace-local days. Missing or incompatible inputs raise, never disappear
-- through filtering, RLS, NULL SUM behavior, or implicit source substitution.
-- Compare membership rather than observation timestamps: unchanged revisions
-- can be shared by several successful runs. This is a current-input selection
-- guard, never another component/Summary financial validation.
create function private.finances_batch_matches_current(
    p_batch_id uuid, p_start date, p_end date
)
returns boolean language sql stable security invoker set search_path = '' as $$
    select exists (
        select 1 from private.finances_preprocess_batches p
        join private.finances_acquisitions a on a.id = p.acquisition_id
        where p.id = p_batch_id and a.reconciliation_start_date <= p_start and a.reconciliation_end_date >= p_end
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

-- Compare each candidate batch's interval once, before expanding the small day
-- calendar. This avoids rescanning a whole regional batch for every market/day.
create function private.current_finances_reconciled_days(
    p_sellers text[], p_start date, p_end date, p_marketplace text
) returns table (
    seller_namespace text, marketplace_name text, activity_date date, preprocess_version text
) language sql stable security invoker set search_path = '' as $$
    with candidates as materialized (
        select b.id as batch_id,a.id as acquisition_id,a.seller_namespace::text,a.amazon_scope,
            a.marketplace_ids,a.api_metadata,a.capture_started_at,b.created_at,
            b.preprocess_version::text,
            greatest(p_start,a.reconciliation_start_date) as start_date,
            least(p_end,a.reconciliation_end_date) as end_date
        from private.finances_acquisitions a
        join private.finances_preprocess_batches b on b.acquisition_id=a.id
        where (p_sellers is null or a.seller_namespace=any(p_sellers))
            and a.reconciliation_start_date<=p_end and a.reconciliation_end_date>=p_start
            and (p_marketplace is null or exists (
                select 1 from jsonb_array_elements(a.api_metadata->'coverage_marketplaces') market
                where market->>'marketplace_name'=p_marketplace
            ))
    ), mismatches as materialized (
        -- A reconciled member was superseded, including movement out of its old day.
        select c.batch_id,v.marketplace_name,v.posted_date
        from candidates c
        join private.finances_preprocess_batch_transactions m on m.batch_id=c.batch_id
        join private.finances_transaction_versions v on v.id=m.version_id
        join private.finances_transactions t on t.id=m.transaction_id
        where v.posted_date between p_start and p_end
            and v.posted_date between c.start_date and c.end_date
            and (p_marketplace is null or v.marketplace_name=p_marketplace)
            and t.current_version_id is distinct from m.version_id
        union
        -- A current transaction/version was not part of that reconciled observation.
        select c.batch_id,v.marketplace_name,v.posted_date
        from candidates c
        join private.finances_transactions t
            on t.seller_namespace=c.seller_namespace and t.amazon_scope=c.amazon_scope
        join private.finances_transaction_versions v on v.id=t.current_version_id
            and v.marketplace_id=any(c.marketplace_ids)
            and v.posted_date between c.start_date and c.end_date
        left join private.finances_preprocess_batch_transactions m
            on m.batch_id=c.batch_id and m.transaction_id=t.id and m.version_id=t.current_version_id
        where v.posted_date between p_start and p_end
            and (p_marketplace is null or v.marketplace_name=p_marketplace)
            and m.transaction_id is null
    ), ranked as (
        select c.seller_namespace,market->>'marketplace_name' as marketplace_name,
            day.value::date as activity_date,c.preprocess_version,
            row_number() over (
                partition by c.seller_namespace,market->>'marketplace_name',day.value::date
                order by c.capture_started_at desc,c.acquisition_id desc,c.created_at desc,c.batch_id desc
            ) as position
        from candidates c
        cross join lateral jsonb_array_elements(c.api_metadata->'coverage_marketplaces') market
        cross join lateral generate_series(c.start_date::timestamp,c.end_date::timestamp,
            interval '1 day') day(value)
        where (p_marketplace is null or market->>'marketplace_name'=p_marketplace)
            and not exists (
                select 1 from mismatches m where m.batch_id=c.batch_id
                    and m.marketplace_name=market->>'marketplace_name'
                    and m.posted_date=day.value::date
            )
    ) select seller_namespace,marketplace_name,activity_date,preprocess_version
        from ranked where position=1;
$$;

create function private.assert_company_source_scope(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_finances_batch_ids uuid[],
    p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns void
language plpgsql stable set search_path = '' as $$
begin
    if nullif(btrim(p_seller_namespace),'') is null or nullif(btrim(p_preprocess_version),'') is null
        or p_start is null or p_end is null or p_end < p_start
        or p_finances_batch_ids is null or p_marketplaces is null
        or p_dataset_key is distinct from 'economics'
        or array_position(p_finances_batch_ids,null) is not null or array_position(p_marketplaces,null) is not null
        or not (p_marketplaces <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg',
            'Non-Amazon DE', 'Non-Amazon IT', 'Non-Amazon US'
        ]::text[]) then
        raise exception 'Explicit valid financial input scope required' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_finances_batch_ids) requested(id)
        left join private.finances_preprocess_batches r on r.id=requested.id
        left join private.finances_acquisitions a on a.id=r.acquisition_id
        where r.id is null or r.preprocess_version<>p_preprocess_version
            or a.seller_namespace<>p_seller_namespace
            or a.reconciliation_start_date is null
            or a.reconciliation_start_date>p_end or a.reconciliation_end_date<p_start
            or not private.finances_batch_matches_current(
                r.id,greatest(p_start,a.reconciliation_start_date),least(p_end,a.reconciliation_end_date))
    ) then raise exception 'Missing or incompatible required Finances run' using errcode='23514'; end if;
    if exists (
        select 1 from (select distinct private.finances_data_kiosk_marketplace(value) name
            from unnest(p_marketplaces) value) m
        cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') date_scope(day)
        left join private.data_kiosk_days d on d.seller_namespace = p_seller_namespace
            and d.marketplace_name = m.name and d.activity_date = date_scope.day::date and d.dataset_key = p_dataset_key
        left join private.data_kiosk_preprocess_batches b on b.id = d.current_batch_id
        where d.current_version_id is null or b.preprocess_version is distinct from p_preprocess_version
    ) then raise exception 'Missing or incompatible required Data Kiosk day coverage' using errcode = '23514'; end if;
end;
$$;

-- Keep one definition of the declared company scope for complete and partial reads.
-- A plain SQL invoker function remains inlinable, preserving predicate pushdown.
create function private.company_components_in_scope(
    p_seller_namespace text, p_start date, p_end date,
    p_finances_batch_ids uuid[], p_marketplaces text[]
) returns setof public.live_company_components
language sql stable security invoker as $$
    select c.* from public.live_company_components c
    where c.category <> 'SELBOX'
        and c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
        and ((c.source = 'FINANCES' and c.source_version_id in (select m.version_id from private.finances_preprocess_batch_transactions m where m.batch_id=any(p_finances_batch_ids)))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name in (select private.finances_data_kiosk_marketplace(value) from unnest(p_marketplaces) value)));
$$;

create function private.company_financial_totals(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_finances_batch_ids uuid[], p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid,
    currency text,
    source_amount numeric,
    fee_amount numeric,
    company_amount numeric
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_finances_batch_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from private.company_components_in_scope(
            p_seller_namespace,p_start,p_end,p_finances_batch_ids,p_marketplaces) c
        where c.resolution_status not in ('APPLIED','NOT_APPLICABLE')
    ) then raise exception 'Unresolved ownership or fee coverage' using errcode = '23514'; end if;
    return query select c.company_id::uuid,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount)
        from private.company_components_in_scope(
            p_seller_namespace,p_start,p_end,p_finances_batch_ids,p_marketplaces) c
        group by c.company_id,c.currency;
end;
$$;

-- Partial live summaries tolerate missing fee coverage only. They never invent
-- zero for an absent sum and never hide missing ownership or source coverage.
create function private.company_financial_progress(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_finances_batch_ids uuid[], p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid, currency text, source_amount numeric, known_fee_amount numeric,
    known_company_amount numeric, missing_fee_count bigint, missing_fee_components jsonb
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_finances_batch_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from private.company_components_in_scope(
            p_seller_namespace,p_start,p_end,p_finances_batch_ids,p_marketplaces) c
        where c.resolution_status = 'MISSING_OWNERSHIP'
    ) then raise exception 'Unresolved ownership' using errcode = '23514'; end if;
    return query
    select c.company_id,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount),
        count(*) filter (where c.resolution_status = 'MISSING_FEE'),
        coalesce(jsonb_agg(
            (to_jsonb(c) - array['source_amount','quantity','fee_base','fee_rate_percent','fee_amount','company_amount'])
            || jsonb_build_object('source_amount',c.source_amount::text,'quantity',c.quantity::text,
                'fee_base',c.fee_base::text,'fee_rate_percent',c.fee_rate_percent::text,
                'fee_amount',c.fee_amount::text,'company_amount',c.company_amount::text)
            order by c.source,c.source_row_id
        ) filter (where c.resolution_status = 'MISSING_FEE'),'[]'::jsonb)
    from private.company_components_in_scope(
            p_seller_namespace,p_start,p_end,p_finances_batch_ids,p_marketplaces) c
    group by c.company_id,c.currency;
end;
$$;
