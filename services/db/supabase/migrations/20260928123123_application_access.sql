-- Application RLS and narrow authorized read projections.
-- noqa: disable=AM04
create policy app_accounts_read on public.app_accounts for select to authenticated
using ((select private.is_operator()) or user_id = (select auth.uid()));
create policy app_accounts_insert on public.app_accounts for insert to authenticated
with check ((select private.is_operator()) and access_role = 'company_member');
create policy app_accounts_update on public.app_accounts for update to authenticated
using ((select private.is_operator()) and access_role = 'company_member')
with check ((select private.is_operator()) and access_role = 'company_member');
create policy app_accounts_delete on public.app_accounts for delete to authenticated
using ((select private.is_operator()) and access_role = 'company_member');
create policy companies_read on public.companies for select to authenticated
using (
    (select private.is_operator()) or id in (
        select a.company_id from public.app_accounts as a
        where a.user_id = (select auth.uid())
    )
);
create policy skus_read on public.skus for select to authenticated using (
    (select private.is_operator()) or id in (
        select o.sku_id from private.current_owned_sku_terms() as o
    )
);
create policy terms_read on public.sku_terms_versions for select to authenticated using (
    (select private.is_operator()) or id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);
create policy periods_read on public.sku_fee_periods for select to authenticated using (
    (select private.is_operator()) or terms_version_id in (
        select o.terms_version_id from private.current_owned_sku_terms() as o
    )
);

create policy settlement_facts_read on private.settlement_transactions
for select to authenticated using (
    (select private.is_operator()) or (
        category = 'SETTLEMENT'
        and sku in (
            select o.sku from private.current_owned_sku_terms() as o
        )
        and version_id in (
            select h.current_version_id from private.settlements as h
        )
    )
);
create policy data_kiosk_facts_read on private.data_kiosk_transactions
for select to authenticated using (
    (select private.is_operator()) or (
        category <> 'SELBOX'
        and sku in (
            select o.sku from private.current_owned_sku_terms() as o
        )
        and version_id in (
            select h.current_version_id from private.data_kiosk_days as h
        )
    )
);
-- Current metadata needs registration and a selected pointer, never a fact scan.
create policy settlement_selection_read on private.settlements
for select to authenticated using (
    (select private.is_operator())
    or ((select private.is_company_member()) and current_version_id is not null)
);
create policy settlement_version_reference_read on private.settlement_preprocess_versions
for select to authenticated using (
    (select private.is_operator()) or (
        (select private.is_company_member())
        and exists (
            select 1 from private.settlements as h
            where h.current_version_id = settlement_preprocess_versions.id
        )
    )
);
create policy data_kiosk_selection_read on private.data_kiosk_days
for select to authenticated using (
    (select private.is_operator())
    or ((select private.is_company_member()) and current_version_id is not null)
);
create policy data_kiosk_version_reference_read on private.data_kiosk_preprocess_versions
for select to authenticated using (
    (select private.is_operator()) or (
        (select private.is_company_member())
        and exists (
            select 1 from private.data_kiosk_days as h
            where h.current_version_id = data_kiosk_preprocess_versions.id
        )
    )
);

-- Full source headers contain account-wide amounts and inventories. Column grants
-- cannot distinguish application roles, so only these gated helpers expose them.
create function private.read_settlement_preprocess_results() returns table (
    id uuid, settlement_id uuid, seller_namespace text, amazon_scope text,
    amazon_settlement_id text, document_sha256 text, acquisition_id uuid,
    preprocess_version text, row_count integer, settlement_start_at timestamptz,
    settlement_end_at timestamptz, deposit_at timestamptz, settlement_start_date date,
    settlement_end_date date, total_amount numeric, currency text, observed_start_date date,
    observed_end_date date, source_line_number integer, diagnostics jsonb,
    created_at timestamptz, is_current boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_operator() then
        raise exception 'Application operator access required' using errcode = '42501';
    end if;
    return query select v.id::uuid,v.settlement_id::uuid,s.seller_namespace::text,s.amazon_scope::text,
        s.settlement_id::text,s.document_sha256::text,v.acquisition_id::uuid,
        v.preprocess_version::text,v.row_count,v.settlement_start_at,v.settlement_end_at,
        v.deposit_at,v.settlement_start_date,v.settlement_end_date,v.total_amount::numeric,
        v.currency,v.observed_start_date,v.observed_end_date,v.source_line_number,
        v.diagnostics,v.created_at,v.id = s.current_version_id
    from private.settlement_preprocess_versions v
    join private.settlements s on s.id = v.settlement_id;
end;
$$;
create function private.read_data_kiosk_preprocess_results() returns table (
    id uuid, day_id uuid, batch_id uuid, acquisition_id uuid, seller_namespace text,
    amazon_scope text, marketplace_name text, activity_date date,
    dataset_key text, preprocess_version text, row_count integer, content_sha256 text,
    created_at timestamptz, is_current boolean, is_pruned boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_operator() then
        raise exception 'Application operator access required' using errcode = '42501';
    end if;
    return query select v.id::uuid,v.day_id::uuid,v.batch_id::uuid,b.acquisition_id::uuid,
        d.seller_namespace::text,a.amazon_scope::text,d.marketplace_name,d.activity_date,
        d.dataset_key::text,v.preprocess_version::text,v.row_count,v.content_sha256::text,
        v.created_at,v.id = d.current_version_id,
        exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = v.id)
    from private.data_kiosk_preprocess_versions v
    join private.data_kiosk_days d on d.id = v.day_id
    join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
    join private.data_kiosk_acquisitions a on a.id = b.acquisition_id;
end;
$$;
create view public.settlement_preprocess_results with (security_invoker = true) as
select * from private.read_settlement_preprocess_results();
create view public.data_kiosk_preprocess_results with (security_invoker = true) as
select * from private.read_data_kiosk_preprocess_results();
create view public.settlement_preprocess_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.settlement_id
from private.settlement_transactions as t
inner join private.settlement_preprocess_versions as v on t.version_id = v.id;
create view public.data_kiosk_preprocess_entries with (security_invoker = true) as
select
    t.*,
    v.preprocess_version,
    v.day_id
from private.data_kiosk_transactions as t
inner join private.data_kiosk_preprocess_versions as v on t.version_id = v.id;

-- Members read their own frozen payouts even if current SKU ownership changes.
-- Complete source manifests and other-company exclusion evidence stay operator-only.
create policy payout_reports_read on public.company_payout_reports for select to authenticated
using ((select private.is_operator()) or company_id in (
    select a.company_id from public.app_accounts as a
    where a.user_id = (select auth.uid()) and a.access_role = 'company_member'
));
create policy payout_components_read on public.company_payout_report_components
for select to authenticated using (
    report_id in (select r.id from public.company_payout_reports as r)
);
-- Sum the full immutable company report, independently of detail pagination.
-- Invoker security keeps the same own-company access as the underlying components.
create view public.payout_report_marketplace_totals with (security_invoker = true) as
select
    report_id,
    marketplace_name,
    sum(source_amount) as source_amount,
    sum(fee_amount) as fee_amount,
    sum(company_amount) as company_amount
from public.company_payout_report_components
where authoritative
group by report_id, marketplace_name;
create policy payout_settlement_versions_read on private.payout_report_settlement_versions
for select to authenticated using ((select private.is_operator()));
create policy payout_data_kiosk_versions_read on private.payout_report_data_kiosk_versions
for select to authenticated using ((select private.is_operator()));
create policy payout_terms_versions_read on private.payout_report_terms_versions
for select to authenticated using ((select private.is_operator()));
create policy payout_reconciliation_read on private.payout_report_reconciliation
for select to authenticated using ((select private.is_operator()));
create view public.payout_report_reconciliation with (security_invoker = true) as
select * from private.payout_report_reconciliation;
create view public.payout_report_settlement_versions with (security_invoker = true) as
select * from private.payout_report_settlement_versions;
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
        case when (select private.is_operator()) then latest.seller_namespace::text end,
        latest.marketplace_name, latest.capture_date, a.report_created_at, latest.created_at
    from (
        select distinct on (c.seller_namespace, c.marketplace_name)
            c.id, c.seller_namespace, c.marketplace_name, c.capture_date, c.acquisition_id, c.created_at
        from private.inventory_daily_captures as c
        where (select private.is_operator()) or (select private.is_company_member())
        order by c.seller_namespace, c.marketplace_name, c.capture_date desc
    ) as latest
    join private.inventory_acquisitions as a on a.id = latest.acquisition_id;
$$;

create policy inventory_acquisitions_read on private.inventory_acquisitions
for select to authenticated using ((select private.is_operator()));
create policy inventory_captures_read on private.inventory_daily_captures
for select to authenticated using ((select private.is_operator()));
create policy inventory_items_read on private.inventory_items
for select to authenticated using (
    (select private.is_operator()) or (
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
