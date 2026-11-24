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
        select 1 from private.source_preprocess_batches p
        join private.source_acquisitions a on a.id = p.acquisition_id
        where p.id = p_batch_id and a.reconciliation_start_date <= p_start and a.reconciliation_end_date >= p_end
            and not exists (
                select 1 from private.source_batch_units m
                join private.finances_transactions r on r.version_id = m.version_id
                join private.source_units t on t.id = m.unit_id
                where m.batch_id = p.id and r.posted_date between p_start and p_end
                    and t.current_version_id is distinct from m.version_id
            )
            and not exists (
                select 1 from private.source_units t
                join private.finances_transactions r on r.version_id = t.current_version_id
                where t.seller_namespace = a.seller_namespace and t.amazon_scope = a.amazon_scope
                    and r.marketplace_id = any(a.marketplace_ids)
                    and r.posted_date between p_start and p_end
                    and not exists (
                        select 1 from private.source_batch_units m
                        where m.batch_id = p.id and m.unit_id = t.id
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
        from private.source_acquisitions a
        join private.source_preprocess_batches b on b.acquisition_id=a.id
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
        join private.source_batch_units m on m.batch_id=c.batch_id
        join private.finances_transactions v on v.version_id=m.version_id
        join private.source_units t on t.id=m.unit_id
        where v.posted_date between p_start and p_end
            and v.posted_date between c.start_date and c.end_date
            and (p_marketplace is null or v.marketplace_name=p_marketplace)
            and t.current_version_id is distinct from m.version_id
        union
        -- A current transaction/version was not part of that reconciled observation.
        select c.batch_id,v.marketplace_name,v.posted_date
        from candidates c
        join private.source_units t
            on t.seller_namespace=c.seller_namespace and t.amazon_scope=c.amazon_scope
        join private.finances_transactions v on v.version_id=t.current_version_id
            and v.marketplace_id=any(c.marketplace_ids)
            and v.posted_date between c.start_date and c.end_date
        left join private.source_batch_units m
            on m.batch_id=c.batch_id and m.unit_id=t.id and m.version_id=t.current_version_id
        where v.posted_date between p_start and p_end
            and (p_marketplace is null or v.marketplace_name=p_marketplace)
            and m.unit_id is null
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
