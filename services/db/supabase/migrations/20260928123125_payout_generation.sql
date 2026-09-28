-- The database chooses source versions and computes amounts for each company month.
-- Reuse an immutable report when its scope and complete input versions match.
create function private.generate_company_payout_reports(p_company_id uuid, p_month date)
returns table (report_id uuid, created boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare month_end date; scope record; settlement_ids uuid[]; marketplaces text[];
    requested_report_id uuid; seller_namespaces text[]; locked_seller text;
begin
    if not private.is_operator() then
        raise exception 'Application operator access required' using errcode = '42501';
    end if;
    perform private.require_read_committed();
    month_end := private.payout_month_end(p_month);
    if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
        raise exception 'A valid company is required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'company_payout_month',p_company_id,p_month
    )::text,0));
    -- Fix membership once; concurrent assignments to another seller are included
    -- on the next request, without changing this request's natural lock order.
    seller_namespaces := private.payout_company_sellers(p_company_id);
    foreach locked_seller in array seller_namespaces loop
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'company_payout_report',locked_seller,p_month
        )::text,0));
    end loop;
    -- Preserve unknown-ownership blocking even when no owned row creates a scope.
    if exists (
        select 1 from (
            select t.seller_namespace,t.sku
            from private.settlement_transactions t
            join private.settlements s on s.current_version_id = t.version_id
            where t.posted_date between p_month and month_end and t.category = 'SETTLEMENT'
                and t.seller_namespace = any(seller_namespaces)
            union all
            select t.seller_namespace,t.sku
            from private.data_kiosk_transactions t
            join private.data_kiosk_days d on d.current_version_id = t.version_id
            where t.activity_date between p_month and month_end and t.category = 'DATA_KIOSK'
                and t.seller_namespace = any(seller_namespaces)
        ) sources
        left join private.current_sku_terms o
            on o.seller_namespace = sources.seller_namespace and o.sku = sources.sku
        where o.company_id is null
    ) then
        raise exception 'Unresolved ownership or fee coverage prevents a complete payout report' using errcode = '23514';
    end if;
    for scope in
        with company_sources as (
            select t.seller_namespace,t.sku,t.currency
            from private.settlement_transactions t
            join private.settlements s on s.current_version_id = t.version_id
            where t.posted_date between p_month and month_end and t.category = 'SETTLEMENT'
                and t.seller_namespace = any(seller_namespaces)
            union all
            select t.seller_namespace,t.sku,t.currency
            from private.data_kiosk_transactions t
            join private.data_kiosk_days d on d.current_version_id = t.version_id
            where t.activity_date between p_month and month_end and t.category = 'DATA_KIOSK'
                and t.seller_namespace = any(seller_namespaces)
        ), scopes as (
            select t.seller_namespace::text,t.currency
            from company_sources t
            join private.current_sku_terms o on o.seller_namespace = t.seller_namespace and o.sku = t.sku
            where o.company_id = p_company_id
            union
            -- A removed scope needs a new zero aggregate, not a stale nonzero latest report.
            select r.seller_namespace::text,r.currency from public.company_payout_reports r
            where r.company_id = p_company_id and r.start_date = p_month and r.seller_namespace is not null
                and r.seller_namespace = any(seller_namespaces)
        )
        -- A company/month always has a scope, even before any company inputs exist.
        select scopes.seller_namespace,scopes.currency
        from (values (p_company_id)) company(id) left join scopes on true
        order by scopes.seller_namespace,scopes.currency
    loop
        settlement_ids := private.payout_settlement_ids(
            case when scope.seller_namespace is null then seller_namespaces
                else array[scope.seller_namespace] end,p_month,month_end);
        select coalesce(array_agg(m.marketplace_name order by m.marketplace_name),'{}'::text[])
            into marketplaces from (
                select d.marketplace_name from private.data_kiosk_days d
                where d.seller_namespace = scope.seller_namespace and d.dataset_key = 'economics'
                union
                select t.marketplace_name from private.settlement_transactions t
                join private.settlements s on s.current_version_id = t.version_id
                where s.id = any(settlement_ids) and scope.seller_namespace is not null
                    and t.posted_date between p_month and month_end and t.marketplace_name is not null
            ) m;
        requested_report_id := private.uuid7();
        report_id := private.publish_company_payout_report(jsonb_build_object(
            'id',requested_report_id,'company_id',p_company_id,'seller_namespace',scope.seller_namespace,
            'currency',scope.currency,'start_date',p_month,'end_date',month_end,
            'preprocess_version',case when scope.seller_namespace is not null then coalesce(
                (select min(v.preprocess_version::text) from (
                    select v.preprocess_version from private.settlement_preprocess_versions v
                    join private.settlements s on s.current_version_id = v.id where s.id = any(settlement_ids)
                    union all
                    select v.preprocess_version from private.data_kiosk_preprocess_versions v
                    join private.data_kiosk_days d on d.current_version_id = v.id
                    where d.seller_namespace = scope.seller_namespace and d.dataset_key = 'economics'
                        and d.activity_date between p_month and month_end
                ) v),
                (select r.preprocess_version::text from public.company_payout_reports r
                    where r.company_id = p_company_id and r.seller_namespace = scope.seller_namespace
                        and r.currency = scope.currency and r.start_date = p_month
                    order by r.created_at desc,r.id desc limit 1)
            ) end,'dataset_key','economics',
            'settlement_ids',settlement_ids,'marketplace_names',marketplaces,
            'report_name',to_char(p_month,'YYYY-MM') || ' payout report',
            'change_reason','Administrator generated monthly payout report'
        ) || case when scope.seller_namespace is null
            then jsonb_build_object('captured_seller_namespaces',seller_namespaces)
            else '{}'::jsonb end);
        created := report_id = requested_report_id;
        return next;
    end loop;
end;
$$;
create function public.generate_company_payout_reports(p_company_id uuid, p_month date)
returns table (report_id uuid, created boolean)
language sql volatile security invoker set search_path = '' as $$
    select * from private.generate_company_payout_reports(p_company_id,p_month);
$$;
create function public.payout_report_policy() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare mature_cutoff_date date := private.mature_cutoff_date();
begin
    if not private.is_operator() and not private.is_company_member() then
        raise exception 'Application account access required' using errcode = '42501';
    end if;
    return jsonb_build_object('mature_cutoff_date',mature_cutoff_date,'mature_cutoff_months',2,
        'latest_month',(date_trunc('month',mature_cutoff_date)::date - interval '1 month')::date);
end;
$$;
