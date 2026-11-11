-- Guarded application mutations, RLS and narrow authorized read projections.
-- noqa: disable=AM04

-- Deletion only removes an unused company. Historical assignments and pending
-- payouts remain dependencies even when the current company directory looks empty.
create function private.delete_administrator_company(target_company_id uuid)
returns table (id uuid, deleted boolean)
language plpgsql security definer set search_path = '' as $$
declare
    blockers jsonb;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    if target_company_id is null then
        raise exception 'Company ID is required' using errcode = '22023';
    end if;
    -- Every company reference takes a conflicting FK key-share lock. Wait for
    -- earlier assignments, then count their committed rows before deciding.
    perform 1 from public.companies as c where c.id = target_company_id for update;
    if not found then
        return query select target_company_id, false;
        return;
    end if;
    select jsonb_agg(jsonb_build_object('code', dependencies.code, 'count', dependencies.count)
        order by dependencies.code collate "C")
    into blockers
    from (
        select 'members' as code, count(*) as count
        from public.app_accounts as a where a.company_id = target_company_id
        union all
        select 'assigned_skus', count(*)
        from private.current_sku_terms as t where t.company_id = target_company_id
        union all
        select 'terms_versions', count(*)
        from public.sku_terms_versions as v where v.company_id = target_company_id
        union all
        select 'payout_reports', count(*)
        from public.company_payout_reports as r where r.company_id = target_company_id
        union all
        select 'payout_refreshes', count(*)
        from private.payout_report_refresh_state as s where s.company_id = target_company_id
    ) as dependencies
    where dependencies.count > 0;
    if blockers is not null then
        raise exception 'Company cannot be deleted while it has linked records'
        using errcode = 'PT409', detail = jsonb_build_object(
            'code', 'COMPANY_DELETION_BLOCKED', 'reasons', blockers)::text;
    end if;
    begin
        delete from public.companies as c where c.id = target_company_id;
    exception when foreign_key_violation then
        -- Fail closed if a future restrictive FK has not yet gained a named reason.
        raise exception 'Company cannot be deleted while it has linked records'
        using errcode = 'PT409', detail = '{"code":"COMPANY_DELETION_BLOCKED","reasons":[{"code":"other_records","count":1}]}';
    end;
    return query select target_company_id, true;
end;
$$;
create function public.delete_company(target_company_id uuid)
returns table (id uuid, deleted boolean)
language sql security invoker set search_path = '' as $$
    select * from private.delete_administrator_company(target_company_id);
$$;

create policy app_accounts_read on public.app_accounts for select to authenticated
using ((select private.is_administrator()) or user_id = (select auth.uid()));
create policy companies_read on public.companies for select to authenticated
using (
    (select private.is_administrator()) or id in (
        select a.company_id from public.app_accounts as a
        where a.user_id = (select auth.uid())
    )
);
create policy skus_read on public.skus for select to authenticated using (
    (select private.is_administrator()) or id in (
        select o.sku_id from private.current_owned_sku_terms() as o
    )
);
create policy terms_read on public.sku_terms_versions for select to authenticated using (
    (select private.is_administrator()) or id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);
create policy periods_read on public.sku_fee_periods for select to authenticated using (
    (select private.is_administrator()) or terms_version_id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);

create policy finances_transaction_components_read on private.finances_transaction_components
for select to authenticated using (
    (select private.is_administrator()) or (
        category = 'FINANCES'
        and sku in (select o.sku from private.current_owned_sku_terms() as o)
        and version_id in (select private.current_owned_finances_revisions())
    )
);
create policy finances_transactions_read on private.finances_transactions
for select to authenticated using (
    (select private.is_administrator())
    or current_version_id in (select private.current_owned_finances_revisions())
);
create policy finances_revisions_read on private.finances_transaction_versions
for select to authenticated using (
    (select private.is_administrator()) or id in (select private.current_owned_finances_revisions())
);
create policy finances_batches_read on private.finances_preprocess_batches
for select to authenticated using (
    (select private.is_administrator()) or id in (
        select t.current_batch_id from private.finances_transactions as t
        where t.current_version_id in (select private.current_owned_finances_revisions())
    )
);
create policy finances_preprocess_batch_transactions_read
on private.finances_preprocess_batch_transactions
for select to authenticated using (
    (select private.is_administrator()) or (
        version_id in (select private.current_owned_finances_revisions())
        and exists (
            select 1 from private.finances_transactions as t
            where
                t.id = finances_preprocess_batch_transactions.transaction_id
                and t.current_batch_id = finances_preprocess_batch_transactions.batch_id
        )
    )
);
-- Resolve caller-owned day identities without recursive parent/child RLS.
create function private.current_owned_data_kiosk_days() returns setof uuid
language sql stable security definer set search_path = '' as $$
    select distinct d.id from private.data_kiosk_days d
    join private.data_kiosk_day_components t on t.version_id=d.current_version_id
    where (select auth.uid()) is not null and (select private.is_member())
        and t.category<>'SELBOX'
        and t.sku in (select o.sku from private.current_owned_sku_terms() o);
$$;
revoke all on function private.current_owned_data_kiosk_days() from public,
anon,
authenticated,
service_role;

create policy data_kiosk_facts_read on private.data_kiosk_day_components
for select to authenticated using (
    (select private.is_administrator()) or (
        category <> 'SELBOX'
        and sku in (
            select o.sku from private.current_owned_sku_terms() as o
        )
        and version_id in (
            select h.current_version_id from private.data_kiosk_days as h
        )
    )
);
create policy data_kiosk_selection_read on private.data_kiosk_days
for select to authenticated using (
    (select private.is_administrator())
    or id in (select private.current_owned_data_kiosk_days())
);
create policy data_kiosk_version_reference_read on private.data_kiosk_day_versions
for select to authenticated using (
    (select private.is_administrator()) or id in (
        select d.current_version_id from private.data_kiosk_days as d
    )
);

-- Day RLS already restricts these references to the caller's current owned data.
create policy data_kiosk_batches_read on private.data_kiosk_preprocess_batches
for select to authenticated using (
    (select private.is_administrator()) or id in (
        select d.current_batch_id from private.data_kiosk_days as d
    )
);
create policy data_kiosk_observations_read on private.data_kiosk_preprocess_batch_days
for select to authenticated using (
    (select private.is_administrator()) or exists (
        select 1 from private.data_kiosk_days as d
        where
            d.id = data_kiosk_preprocess_batch_days.day_id
            and d.current_batch_id = data_kiosk_preprocess_batch_days.batch_id
    )
);

-- Full source headers contain account-wide amounts and inventories. Column grants
-- cannot distinguish application roles, so only these gated helpers expose them.
create function private.read_finances_preprocess_results() returns table (
    id uuid, acquisition_id uuid, seller_namespace text, amazon_scope text,
    posted_after timestamptz, posted_before timestamptz,
    reconciliation_start_date date, reconciliation_end_date date, preprocess_version text,
    transaction_count integer, component_count integer, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_administrator() then raise exception 'Administrator access required' using errcode='42501'; end if;
    return query select r.id::uuid,r.acquisition_id::uuid,a.seller_namespace::text,a.amazon_scope::text,
        a.posted_after,a.posted_before,a.reconciliation_start_date,a.reconciliation_end_date,
        r.preprocess_version::text,r.transaction_count,r.component_count,r.created_at
        from private.finances_preprocess_batches r join private.finances_acquisitions a on a.id=r.acquisition_id;
end;
$$;
create function private.read_data_kiosk_preprocess_results() returns table (
    id uuid, acquisition_id uuid, seller_namespace text, amazon_scope text,
    query_start_date date, query_end_date date, preprocess_version text,
    day_count integer, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_administrator() then raise exception 'Administrator access required' using errcode='42501'; end if;
    return query select b.id::uuid,b.acquisition_id::uuid,a.seller_namespace::text,a.amazon_scope::text,
        a.query_start_date,a.query_end_date,b.preprocess_version::text,b.day_count,b.created_at
        from private.data_kiosk_preprocess_batches b
        join private.data_kiosk_acquisitions a on a.id=b.acquisition_id;
end;
$$;
create view public.finances_preprocess_results with (security_invoker = true) as
select * from private.read_finances_preprocess_results();
create view public.data_kiosk_preprocess_results with (security_invoker = true) as
select * from private.read_data_kiosk_preprocess_results();
-- One row per immutable component, with an explicitly selected observed location.
-- The full source datasets are administrator-only. Member transaction reads use
-- the separate current allocation view and its underlying ownership policies.
create view public.finances_preprocess_entries with (security_invoker = true) as
select
    d.*,
    observation.batch_id,
    observation.preprocess_version,
    observation.source_page_number,
    observation.source_record_number
from private.finances_component_details as d
inner join lateral (
    select
        m.batch_id,
        p.preprocess_version,
        m.source_page_number,
        m.source_record_number
    from private.finances_preprocess_batch_transactions as m
    inner join private.finances_preprocess_batches as p on m.batch_id = p.id
    where m.version_id = d.version_id
    order by (m.batch_id = d.current_batch_id) desc, p.created_at desc, p.id desc limit 1
) as observation on true
where (select private.financial_account_visible());
create view public.data_kiosk_preprocess_entries with (security_invoker = true) as
select
    d.*,
    observation.batch_id,
    observation.preprocess_version,
    observation.acquisition_id
from private.data_kiosk_component_details as d
inner join lateral (
    select
        m.batch_id,
        b.preprocess_version,
        b.acquisition_id
    from private.data_kiosk_preprocess_batch_days as m
    inner join private.data_kiosk_preprocess_batches as b on m.batch_id = b.id
    where m.version_id = d.version_id
    order by (m.batch_id = d.current_batch_id) desc, b.created_at desc, b.id desc limit 1
) as observation on true
where (select private.financial_account_visible());

-- Members read their own frozen payouts even if current SKU ownership changes.
-- Supporting rows, complete manifests and exclusion evidence stay administrator-only.
create policy payout_reports_read on public.company_payout_reports for select to authenticated
using ((select private.is_administrator()) or company_id in (
    select a.company_id from public.app_accounts as a
    where a.user_id = (select auth.uid()) and a.access_role = 'member'
));
-- One latest report per company/month/marketplace and currency. Source namespaces
-- are provenance only. Invoker security keeps the underlying company RLS.
create view public.latest_company_payout_reports with (security_invoker = true) as
select distinct on (
    r.company_id, r.start_date, r.marketplace_name, r.currency
) r.*
from public.company_payout_reports as r
where
    r.currency is not null or not exists (
        select 1 from public.company_payout_reports as other
        where
            other.company_id = r.company_id and other.start_date = r.start_date
            and other.currency is not null
    )
order by
    r.company_id asc, r.start_date asc, r.marketplace_name asc,
    r.currency asc, r.created_at desc, r.id desc;

-- Historical report access follows the saved company, not current SKU ownership.
-- The private reader first authorizes that report, then reads only its pinned
-- sources and terms as owner. No arbitrary source/version IDs are accepted.
create function private.read_payout_report_records(p_report_id uuid)
returns table (
    report_id uuid, source text, authoritative boolean,
    source_row_id uuid, source_version_id uuid, source_identity_id uuid,
    sku_id uuid, terms_version_id uuid, fee_period_id uuid, sku text,
    marketplace_name text, activity_date date, component_type text, currency text,
    source_amount numeric, quantity numeric, fee_base numeric, fee_rate_percent numeric,
    fee_amount numeric, company_amount numeric, resolution_status text
) language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare report public.company_payout_reports; account public.app_accounts;
    caller_role name := coalesce(nullif(current_setting('role',true),'none'),session_user::text)::name;
    trusted boolean; supporting_allowed boolean;
    finances_versions uuid[]; kiosk_versions uuid[]; terms_versions uuid[];
begin
    if p_report_id is null then
        raise exception 'Report is required' using errcode='22023';
    end if;
    -- SECURITY DEFINER changes current_user, but not the caller's SET ROLE.
    -- Only the actual table owner (or a role inheriting it) is a trusted SQL reader.
    select pg_has_role(caller_role,c.relowner,'USAGE') into trusted
        from pg_class c where c.oid='public.company_payout_reports'::regclass;
    if not trusted then
        select * into account from public.app_accounts a where a.user_id=auth.uid();
        if not found or account.access_role not in ('administrator','member') then
            raise exception 'Report access required' using errcode='42501';
        end if;
    end if;
    select * into report from public.company_payout_reports r
    where r.id=p_report_id and (trusted or account.access_role='administrator'
        or (account.access_role='member' and r.company_id=account.company_id));
    if not found then raise exception 'Report access required' using errcode='42501'; end if;
    supporting_allowed:=trusted or account.access_role='administrator';
    select coalesce(array_agg(p.version_id order by p.transaction_id),'{}'::uuid[])
        into finances_versions from private.payout_report_finances_versions p where p.report_id=report.id;
    select coalesce(array_agg(p.version_id order by p.day_id),'{}'::uuid[])
        into kiosk_versions from private.payout_report_data_kiosk_versions p where p.report_id=report.id;
    select coalesce(array_agg(p.terms_version_id order by p.sku_id),'{}'::uuid[])
        into terms_versions from private.payout_report_terms_versions p where p.report_id=report.id;
    return query
    select report.id::uuid,c.source,c.authoritative,
        c.source_row_id,c.source_version_id,c.source_identity_id,
        c.sku_id,c.terms_version_id,c.fee_period_id,c.sku,
        c.marketplace_name,c.activity_date,c.component_type,c.currency,
        c.source_amount,c.quantity,c.fee_base,c.fee_rate_percent,
        c.fee_amount,c.company_amount,c.resolution_status
    from private.resolve_company_components(finances_versions,kiosk_versions,terms_versions) c
    where c.category<>'SELBOX' and (c.authoritative or c.source='DATA_KIOSK')
        and c.company_id=report.company_id
        and c.marketplace_name is not distinct from report.marketplace_name
        and c.currency=report.currency
        and c.activity_date between report.start_date and report.end_date
        and (supporting_allowed or c.authoritative);
end;
$$;

create policy payout_finances_versions_read on private.payout_report_finances_versions
for select to authenticated using ((select private.is_administrator()));
create policy payout_data_kiosk_versions_read on private.payout_report_data_kiosk_versions
for select to authenticated using ((select private.is_administrator()));
create policy payout_terms_versions_read on private.payout_report_terms_versions
for select to authenticated using ((select private.is_administrator()));
-- Financial review is a source comparison, not a second company ledger. Retain
-- both current sources in every allocation category without ownership/fee joins.
-- Administrator gates are necessary because base facts also have member read policies.
-- The caller chooses the date range independently of payout maturity.
create view public.financial_review_records with (security_invoker = true) as
select
    'FINANCES'::text as source, -- noqa: RF04
    t.id as source_row_id,
    t.version_id as source_version_id,
    t.posted_date as activity_date,
    t.seller_namespace,
    t.marketplace_name,
    t.sku,
    t.component_type,
    t.category,
    t.currency,
    t.amount
from private.finances_component_details as t
where
    t.is_current and t.activity_eligible
    and (select private.financial_account_visible())
union all
select
    'DATA_KIOSK'::text as source, -- noqa: RF04
    t.id,
    t.version_id,
    t.activity_date,
    t.seller_namespace,
    t.marketplace_name,
    t.sku,
    t.component_type,
    t.category,
    t.currency,
    t.amount
from private.data_kiosk_component_details as t
where
    t.is_current and (select private.financial_account_visible())
    and t.category in ('FINANCES', 'DATA_KIOSK', 'SELBOX');

-- Direct activity-date bounds are applied before aggregation. Filtering a
-- date_trunc output in a view cannot use the source date indexes under RLS.
create function private.validate_financial_review_scope(
    p_month_from date, p_month_to date, p_category public.allocation_category, p_marketplace text
) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_month_from is null or p_month_to is null
        or not isfinite(p_month_from) or not isfinite(p_month_to)
        or p_month_to <= p_month_from
        or p_month_from <> date_trunc('month',p_month_from::timestamp)::date
        or p_month_to <> date_trunc('month',p_month_to::timestamp)::date
        or p_category is null or p_category not in ('FINANCES','DATA_KIOSK','SELBOX')
        or p_marketplace is null then
        raise exception 'Financial review requires a marketplace, category and valid half-open month range'
            using errcode = '22023';
    end if;
    perform private.validate_transaction_filters(null, null, null, null, array[p_marketplace]);
end;
$$;

create function public.financial_review_type_totals(
    p_month_from date, p_month_to date, p_category public.allocation_category, p_currency text,
    p_marketplace text
) returns table (
    month date, category public.allocation_category, marketplace_name text, currency text,
    source text, component_type text, amount numeric, row_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
begin
    perform private.validate_financial_review_scope(p_month_from,p_month_to,p_category,p_marketplace);
    if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Financial review requires a currency' using errcode = '22023';
    end if;
    return query
    select date_trunc('month',r.activity_date::timestamp)::date,r.category,r.marketplace_name,r.currency,
        r.source,r.component_type::text,sum(r.amount),count(*)
    from public.financial_review_records r
    where r.activity_date >= p_month_from and r.activity_date < p_month_to
        and r.category = p_category and r.currency = p_currency and r.marketplace_name = p_marketplace
    group by date_trunc('month',r.activity_date::timestamp)::date,
        r.category,r.marketplace_name,r.currency,r.source,r.component_type;
end;
$$;

-- Native diagnostics expose additive source/category amounts only. Application
-- callers must be administrators; trusted database roles retain invoker access.
create policy finances_acquisition_diagnostics_read on private.finances_acquisitions
for select to authenticated using ((select private.is_administrator()));

create function private.read_source_totals(
    p_report_id uuid, p_start date, p_end date, p_marketplace text,
    p_grouping text, p_currency text, p_category public.allocation_category,
    p_limit integer, p_offset bigint
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare scope_start date := p_start; scope_end date := p_end;
    scope_marketplace text := p_marketplace; scope_currency text := p_currency;
    revision jsonb := null; result jsonb; coverage jsonb; scope jsonb;
begin
    if not private.financial_account_visible() then
        raise exception 'Administrator access required' using errcode='42501';
    end if;
    if p_grouping is null or p_grouping not in ('total','month','day') then
        raise exception 'Choose total, month or day grouping' using errcode='22023';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    if p_report_id is not null then
        if p_start is not null or p_end is not null or p_marketplace is not null
            or p_currency is not null or p_category is not null then
            raise exception 'Saved report scope cannot be overridden' using errcode='22023';
        end if;
        select r.start_date,r.end_date,r.marketplace_name,r.currency,r.source_coverage
        into scope_start,scope_end,scope_marketplace,scope_currency,coverage
        from public.company_payout_reports r where r.id=p_report_id;
        if not found then raise exception 'Payout report not found' using errcode='22023'; end if;
    else
        if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
            or p_start>p_end or p_marketplace is null
            or (p_currency is not null and p_currency !~ '^[A-Z]{3}$')
            or (p_category is not null and p_category not in ('FINANCES','SELBOX','DATA_KIOSK')) then
            raise exception 'Choose a valid source date, marketplace and currency scope' using errcode='22023';
        end if;
        perform private.validate_transaction_filters(p_start,p_end,null,null,array[p_marketplace]);
        if private.is_administrator() then
            revision:=public.workspace_revisions(array['finances','data_kiosk'])->'revisions';
        end if;
    end if;
    scope:=jsonb_build_object('start_date',scope_start,'end_date',scope_end,
        'marketplace_name',scope_marketplace,'currency',scope_currency);
    if p_report_id is not null then scope:=scope||jsonb_build_object('report_id',p_report_id); end if;
    with inputs as (
        select r.source,r.seller_namespace,r.activity_date,r.marketplace_name,r.currency,
            r.category,r.amount
        from public.financial_review_records r where p_report_id is null
        union all
        select 'FINANCES',t.seller_namespace,v.posted_date,v.marketplace_name,v.currency,
            c.category,c.amount
        from private.payout_report_finances_versions p
        join private.finances_transaction_versions v on v.id=p.version_id
        join private.finances_transactions t on t.id=v.transaction_id
        join private.finances_transaction_components c on c.version_id=v.id
        where p.report_id=p_report_id and v.activity_eligible
        union all
        select 'DATA_KIOSK',d.seller_namespace,d.activity_date,d.marketplace_name,c.currency,
            c.category,c.amount
        from private.payout_report_data_kiosk_versions p
        join private.data_kiosk_days d on d.id=p.day_id
        join private.data_kiosk_day_components c on c.version_id=p.version_id
        where p.report_id=p_report_id
    ), grouped as materialized (
        select case when p_grouping='day' then i.seller_namespace::text end as seller_namespace,
            case when p_grouping='day' then i.activity_date
                when p_grouping='month' then date_trunc('month',i.activity_date::timestamp)::date end as period,
            i.marketplace_name,i.currency,i.source,i.category,sum(i.amount) as amount,count(*) as row_count
        from inputs i
        where i.activity_date between scope_start and scope_end
            and i.marketplace_name is not distinct from scope_marketplace
            and ((p_report_id is null and scope_currency is null) or i.currency=scope_currency)
            and i.category in ('FINANCES','SELBOX','DATA_KIOSK')
            and (p_category is null or i.category=p_category)
        group by 1,2,3,4,5,6
    ), buckets as materialized (
        select distinct seller_namespace,period,marketplace_name,currency from grouped
    ), selected_buckets as (
        select * from buckets
        order by seller_namespace nulls first,period nulls first,marketplace_name,currency
        limit case when p_grouping='day' then p_limit end
        offset case when p_grouping='day' then p_offset else 0 end
    ), rows as (
        select g.* from grouped g join selected_buckets b
            on (g.seller_namespace,g.period,g.marketplace_name,g.currency)
                is not distinct from (b.seller_namespace,b.period,b.marketplace_name,b.currency)
    ), inventory as (select count(*) as count from buckets)
    select jsonb_build_object(
        'scope',scope,'revision',revision,
        'rows',coalesce((select jsonb_agg(jsonb_build_object(
            'seller_namespace',r.seller_namespace,'period',r.period,
            'marketplace_name',r.marketplace_name,'currency',r.currency,
            'source',r.source,'category',r.category,'amount',r.amount::text,'row_count',r.row_count::text)
            order by r.seller_namespace nulls first,r.period nulls first,r.marketplace_name,
                r.currency,r.source,r.category) from rows r),'[]'::jsonb),
        'total_count',inventory.count::text,
        'next_offset',case when p_grouping='day' and p_offset+p_limit<inventory.count
            then p_offset+p_limit end)
    into result from inventory;
    if p_report_id is not null then
        -- Empty Finance periods have no revision IDs. Their accepted retrieval
        -- coverage was captured when this report was published, independently
        -- of monetary version selection and all later preprocessing runs.
        select coalesce(jsonb_agg(entry-'marketplace_name'
            order by entry->>'source',entry->>'seller_namespace',entry->>'start_date',entry->>'end_date'),'[]'::jsonb)
        into coverage from jsonb_array_elements(coverage) entry
        where entry->>'marketplace_name' is not distinct from scope_marketplace;
    else
    with finance_days as (
        select seller_namespace,activity_date
        from private.current_finances_reconciled_days(null,scope_start,scope_end,scope_marketplace)
    ), finance_ranges as (
        select seller_namespace,range_agg(daterange(activity_date,activity_date+1,'[)')) as periods
        from finance_days group by seller_namespace
    ), covered as (
        select 'FINANCES'::text as source,f.seller_namespace,
            lower(period) as start_date,upper(period)-1 as end_date
        from finance_ranges f cross join lateral unnest(f.periods) period
        union
        select 'DATA_KIOSK',d.seller_namespace::text,d.activity_date,d.activity_date
        from private.data_kiosk_days d
        where d.dataset_key='economics' and d.marketplace_name=scope_marketplace
            and d.activity_date between scope_start and scope_end
            and d.current_version_id is not null
    )
    select coalesce(jsonb_agg(to_jsonb(c) order by c.source,c.seller_namespace,c.start_date,c.end_date),'[]'::jsonb)
        into coverage from covered c;
    end if;
    return result||jsonb_build_object('coverage',coverage);
end;
$$;

create function public.current_source_totals(
    p_start date, p_end date, p_marketplace text, p_grouping text default 'month',
    p_currency text default null, p_category public.allocation_category default null,
    p_limit integer default 50, p_offset bigint default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
    select private.read_source_totals(null,p_start,p_end,p_marketplace,p_grouping,p_currency,p_category,p_limit,p_offset);
$$;

create function public.report_source_totals(
    p_report_id uuid, p_grouping text default 'total',
    p_limit integer default 50, p_offset bigint default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
    select private.read_source_totals(p_report_id,null,null,null,p_grouping,null,null,p_limit,p_offset);
$$;

create view public.payout_report_finances_versions with (security_invoker = true) as
select * from private.payout_report_finances_versions;
create view public.payout_report_data_kiosk_versions with (security_invoker = true) as
select * from private.payout_report_data_kiosk_versions;
create view public.payout_report_terms_versions with (security_invoker = true) as
select * from private.payout_report_terms_versions;

-- Select whole source scopes before ownership filtering. A newer empty capture
-- must hide old SKU rows even when its own item set has nothing visible.
create function private.latest_inventory_capture_references() returns table (
    capture_id uuid, seller_namespace text, marketplace_name text, capture_date date,
    report_created_at timestamptz, preprocessed_at timestamptz
)
language sql stable security definer set search_path = '' as $$
    select latest.id::uuid,
        case when (select private.is_administrator()) then latest.seller_namespace::text end,
        latest.marketplace_name, latest.capture_date, a.report_created_at, latest.created_at
    from (
        select distinct on (c.seller_namespace, c.marketplace_name)
            c.id, c.seller_namespace, c.marketplace_name, c.capture_date, c.acquisition_id, c.created_at
        from private.inventory_daily_captures as c
        where (select private.is_administrator()) or (select private.is_member())
        order by c.seller_namespace, c.marketplace_name, c.capture_date desc
    ) as latest
    join private.inventory_acquisitions as a on a.id = latest.acquisition_id;
$$;

create policy inventory_acquisitions_read on private.inventory_acquisitions
for select to authenticated using ((select private.is_administrator()));
create policy inventory_captures_read on private.inventory_daily_captures
for select to authenticated using ((select private.is_administrator()));
create policy inventory_items_read on private.inventory_items
for select to authenticated using (
    (select private.is_administrator()) or (
        sku in (select o.sku from private.current_owned_sku_terms() as o)
        and capture_id in (
            select c.capture_id from private.latest_inventory_capture_references() as c
        )
    )
);

create view public.latest_inventory_captures with (security_invoker = true) as
select
    capture_id,
    seller_namespace,
    marketplace_name,
    capture_date,
    report_created_at,
    preprocessed_at
from private.latest_inventory_capture_references();

create view public.latest_inventory_items with (security_invoker = true) as
select
    c.capture_id,
    c.seller_namespace,
    c.capture_date,
    c.marketplace_name,
    i.sku,
    o.company_id,
    c.report_created_at,
    c.preprocessed_at,
    i.snapshot_date,
    i.available_quantity,
    i.fba_supply_quantity,
    i.inbound_quantity,
    i.inbound_working_quantity,
    i.inbound_shipped_quantity,
    i.inbound_received_quantity,
    i.reserved_quantity,
    i.reserved_transfer_quantity,
    i.reserved_processing_quantity,
    i.reserved_customer_order_quantity,
    i.unfulfillable_quantity,
    i.sales_amount_90d,
    i.units_shipped_90d,
    i.currency,
    i.health_status,
    i.minimum_inventory_units,
    i.days_of_supply,
    i.total_days_of_supply,
    i.recommended_ship_in_units,
    i.recommended_ship_in_date,
    i.recommended_action
from public.latest_inventory_captures as c
inner join private.inventory_items as i on c.capture_id = i.capture_id
left join public.company_skus as o on i.sku = o.sku;

revoke all on function private.latest_inventory_capture_references()
from public, anon, authenticated, service_role;
revoke all on public.latest_inventory_captures, public.latest_inventory_items
from public, anon, authenticated, service_role;
