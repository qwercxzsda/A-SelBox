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
        select 'terms_versions', count(*) from public.assignment_versions where company_id=target_company_id
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
create policy assignment_keys_read on public.assignment_keys for select to authenticated using (
    (select private.is_administrator()) or id in (
        select o.sku_id from private.current_owned_sku_terms() as o
    )
);
create policy assignment_versions_read on public.assignment_versions
for select to authenticated using (
    (select private.is_administrator()) or id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);
create policy periods_read on public.sku_fee_periods for select to authenticated using (
    (select private.is_administrator()) or assignment_version_id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);

create policy finances_amounts_read on private.finances_amounts for select to authenticated using (
    (
        select private.is_administrator()
    )
    or (
        route = 'SKU' and sku in (select sku from private.current_owned_sku_terms())
        and version_id in (select private.current_owned_finances_revisions())
    )
);
create policy units_read on private.source_units for select to authenticated using (
    (select private.is_administrator())
    or current_version_id in (select private.current_owned_finances_revisions())
);
create policy source_versions_read on private.source_unit_versions
for select to authenticated using (
    (select private.is_administrator()) or id in (select private.current_owned_finances_revisions())
);
create policy finance_headers_read on private.finances_transactions
for select to authenticated using (
    (select private.is_administrator())
    or version_id in (select private.current_owned_finances_revisions())
);
create policy source_batches_read on private.source_preprocess_batches
for select to authenticated using (
    (select private.is_administrator()) or id in (select current_batch_id from private.source_units)
);
create policy source_batch_units_read on private.source_batch_units
for select to authenticated using (
    (select private.is_administrator()) or exists (
        select 1 from private.source_units as u
        where
            u.id = source_batch_units.unit_id
            and u.current_version_id = source_batch_units.version_id
            and u.current_batch_id = source_batch_units.batch_id
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
        a.asked_from,a.asked_until,a.reconciliation_start_date,a.reconciliation_end_date,
        r.preprocess_version::text,r.unit_count,r.row_count,r.created_at
        from private.source_preprocess_batches r join private.source_acquisitions a on a.id=r.acquisition_id where a.source='FINANCES';
end;
$$;
create view public.finances_preprocess_results with (security_invoker = true) as
select * from private.read_finances_preprocess_results();
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
        m.document_number as source_page_number,
        m.record_number as source_record_number
    from private.source_batch_units as m
    inner join private.source_preprocess_batches as p on m.batch_id = p.id
    where m.version_id = d.version_id
    order by (m.batch_id = d.current_batch_id) desc, p.created_at desc, p.id desc limit 1
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

-- Each start date present in report history has a latest report, including
-- months whose only report is empty. RLS scopes this one snapshot to the caller.
create function public.payout_search_months() returns date[]
language plpgsql stable security invoker set search_path = '' as $$
begin
    if not private.is_administrator() and not private.is_member() then raise insufficient_privilege; end if;
    return array(select distinct start_date from public.company_payout_reports order by start_date);
end;
$$;

create policy payout_sources_admin on private.payout_report_source_versions
for select to authenticated
using ((select private.is_administrator()));
create policy payout_assignments_admin on private.payout_report_assignment_versions
for select to authenticated
using ((select private.is_administrator()));
create view public.payout_report_source_versions with (security_invoker = true) as
select * from private.payout_report_source_versions;
create view public.payout_report_assignment_versions with (security_invoker = true) as
select * from private.payout_report_assignment_versions;

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

-- Recalculate detail from pinned source and assignment versions.
create function private.read_payout_report_records(
    p_report_id uuid, p_from date default null, p_types text[] default null
)
returns table (
    report_id uuid,
    source text,
    source_row_id uuid,
    source_version_id uuid,
    source_identity_id uuid,
    sku_id uuid,
    terms_version_id uuid,
    fee_period_id uuid,
    sku text,
    marketplace_name text,
    activity_date date,
    component_type text,
    currency text,
    base_amount numeric,
    tax_amount numeric,
    source_amount numeric,
    quantity numeric,
    fee_base numeric,
    fee_rate_percent numeric,
    fee_amount numeric,
    company_amount numeric,
    resolution_status text
)
language plpgsql stable security definer set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    r public.company_payout_reports;
    source_ids uuid[];
    assignment_ids uuid[];
begin
    select * into r from public.company_payout_reports where id=p_report_id;
    if not found or not (private.is_administrator() or exists(select 1 from public.app_accounts a
        where a.user_id=auth.uid() and a.access_role='member' and a.company_id=r.company_id)
        or pg_has_role(coalesce(nullif(current_setting('role',true),'none'),session_user::text)::name,
            (select relowner from pg_class where oid='public.app_accounts'::regclass),'USAGE')) then
        raise insufficient_privilege;
    end if;
    -- Passing pin arrays as ordinary arguments allows the planner to inline the
    -- allocation and push the report filters into its source and owner joins.
    source_ids := array(
        select p.version_id::uuid from private.payout_report_source_versions p where p.report_id = r.id
    );
    assignment_ids := array(
        select p.version_id::uuid from private.payout_report_assignment_versions p where p.report_id = r.id
    );
    return query select r.id::uuid,f.source,f.source_row_id,f.source_version_id,f.source_identity_id,f.sku_id,
        f.terms_version_id,f.fee_period_id,f.sku,f.marketplace_name,f.posted_date,f.component_type,f.currency,
        f.base_amount,f.tax_amount,f.base_amount+f.tax_amount,f.quantity,f.fee_base,f.fee_rate_percent,
        f.fee_amount,f.company_amount,f.resolution_status
    from private.calculate_amounts(source_ids,assignment_ids) f
    where f.company_id = r.company_id and f.posted_date between greatest(r.start_date, p_from) and r.end_date
        and (coalesce(cardinality(p_types), 0) = 0 or f.component_type = any(p_types))
        and (f.marketplace_name,f.currency)=(r.marketplace_name,r.currency);
end;
$$;

do $$
declare child text;
begin
    foreach child in array array['ad_invoices','ad_invoice_lines','storage_rows','aged_storage_rows','removal_order_rows',
        'inventory_ledger_rows','campaigns','campaign_products','promotions','promotion_products','shipments','shipment_items'] loop
        execute format('create policy administrator_read on private.%I for select to authenticated using ((select private.is_administrator()))',child);
    end loop;
end;
$$;

-- Deferred validation runs after both pin inventories have been written.
create function private.check_company_payout_report() returns trigger
language plpgsql set search_path = '' as $$
begin
    if not exists(select 1 from private.read_payout_report_records(new.id) p
        having (count(*),coalesce(sum(p.source_amount),0),coalesce(sum(p.fee_amount),0),coalesce(sum(p.company_amount),0))
            =(new.record_count,new.source_amount,new.fee_amount,new.company_amount)) then
        raise exception 'Payout totals differ from their pinned versions' using errcode='23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_company_payout_report
after insert on public.company_payout_reports
deferrable initially deferred for each row execute function private.check_company_payout_report();
