-- Changes enqueue small month sets. Only a new historical scope requires a
-- wider refresh: seller discovery and marketplace coverage span source history.
create function private.payout_source_has_new_skus(p_seller text, p_skus text[])
returns boolean language sql stable security invoker set search_path = '' as $$
    select exists (
        select 1 from unnest(p_skus) source_skus(sku)
        where source_skus.sku is not null
            and not exists (select 1 from private.settlement_transactions t
                where t.seller_namespace = p_seller and t.sku = source_skus.sku)
            and not exists (select 1 from private.data_kiosk_transactions t
                where t.seller_namespace = p_seller and t.sku = source_skus.sku)
    );
$$;

create function private.payout_settlement_months(p_versions uuid[])
returns date[] language sql stable security invoker set search_path = '' as $$
    select coalesce(array_agg(distinct source_month order by source_month),'{}'::date[])
    from (
        select date_trunc('month',t.posted_date)::date as source_month
        from private.settlement_transactions t
        where t.version_id = any(p_versions) and isfinite(t.posted_date)
        union
        select m.source_month::date
        from private.settlement_preprocess_versions v
        cross join lateral generate_series(
            date_trunc('month',case when isfinite(v.settlement_start_date)
                then v.settlement_start_date end),
            date_trunc('month',case when isfinite(v.settlement_end_date)
                then v.settlement_end_date end),interval '1 month'
        ) m(source_month)
        where v.id = any(p_versions)
    ) months;
$$;

create index payout_terms_sku_idx
on private.payout_report_terms_versions (sku_id, report_id);
create index payout_settlement_version_idx
on private.payout_report_settlement_versions (version_id, report_id);

-- Empty reports capture historically owned terms even without monthly rows.
-- Other companies can also depend on these terms to exclude another owner's
-- amounts. Pending source months include unresolved SKUs with no saved manifest;
-- unrelated completed reports stay clean. Pins also find formerly unowned SKUs
-- that were absent from a report's terms manifest.
create function private.invalidate_payout_sku_terms(p_sku_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare affected_months date[]; owner_companies uuid[]; affected_scope record;
begin
    select coalesce(array_agg(distinct source_month),'{}'::date[]) into affected_months
    from (
        select date_trunc('month',t.posted_date)::date as source_month
        from public.skus s join private.settlement_transactions t on t.sku = s.sku
        where s.id = any(p_sku_ids) and isfinite(t.posted_date)
        union
        select date_trunc('month',t.activity_date)::date
        from public.skus s join private.data_kiosk_transactions t on t.sku = s.sku
        where s.id = any(p_sku_ids) and isfinite(t.activity_date)
    ) months;
    select coalesce(array_agg(distinct v.company_id),'{}'::uuid[]) into owner_companies
    from public.sku_terms_versions v
    where v.sku_id = any(p_sku_ids) and v.company_id is not null;
    for affected_scope in
        with dependent_reports as (
            select v.report_id from private.payout_report_terms_versions v
            where v.sku_id = any(p_sku_ids)
            union
            select p.report_id from public.skus s
            join private.settlement_transactions t on t.sku = s.sku
            join private.payout_report_settlement_versions p on p.version_id = t.version_id
            where s.id = any(p_sku_ids)
            union
            select p.report_id from public.skus s
            join private.data_kiosk_transactions t on t.sku = s.sku
            join private.payout_report_data_kiosk_versions p on p.version_id = t.version_id
            where s.id = any(p_sku_ids)
        ), affected_scopes as (
            select s.company_id,s.month from private.payout_report_refresh_state s
            where s.company_id = any(owner_companies)
            union
            select s.company_id,s.month from private.payout_report_refresh_state s
            where s.requested_revision > s.completed_revision and s.month = any(affected_months)
            union
            select r.company_id,r.start_date from public.company_payout_reports r
            join dependent_reports d on d.report_id = r.id
        )
        select company_id,array_agg(month order by month) as months
        from affected_scopes group by company_id order by company_id
    loop
        perform private.request_payout_report_refresh(affected_scope.months,array[affected_scope.company_id]);
    end loop;
end;
$$;
