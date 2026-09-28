-- Application RLS, narrow read projections, and operator terms publication.
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
create policy seller_skus_read on public.seller_skus for select to authenticated using (
    (select private.is_operator()) or id in (
        select o.seller_sku_id from private.current_owned_sku_terms() as o
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
        and (seller_namespace, sku) in (
            select
                o.seller_namespace,
                o.sku
            from private.current_owned_sku_terms() as o
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
        and (seller_namespace, sku) in (
            select
                o.seller_namespace,
                o.sku
            from private.current_owned_sku_terms() as o
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

-- Operators publish one complete revision with CAS; they cannot write immutable
-- tables or choose internal IDs. Source publishers stay direct-SQL only.
create function private.publish_operator_sku_terms(
    p_seller_namespace text, p_sku text, p_company_id uuid,
    p_expected_current_version_id uuid, p_change_reason text, p_periods jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare periods_with_ids jsonb;
begin
    if not private.is_operator() then
        raise exception 'Application operator access required' using errcode = '42501';
    end if;
    if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
        raise exception 'A complete periods array is required' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_periods) p where jsonb_typeof(p) <> 'object') then
        raise exception 'Each period must be an object' using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(p || jsonb_build_object('id',private.uuid7())),'[]'::jsonb)
        into periods_with_ids from jsonb_array_elements(p_periods) p;
    return private.publish_sku_terms(jsonb_build_object(
        'id',private.uuid7(),'seller_sku_id',private.uuid7(),
        'seller_namespace',p_seller_namespace,'sku',p_sku,'company_id',p_company_id,
        'expected_current_version_id',p_expected_current_version_id,
        'change_reason',p_change_reason,'periods',periods_with_ids
    ));
end;
$$;
create function public.publish_sku_terms(
    p_seller_namespace text, p_sku text, p_company_id uuid,
    p_expected_current_version_id uuid, p_change_reason text, p_periods jsonb
) returns uuid language sql volatile security invoker set search_path = '' as $$
    select private.publish_operator_sku_terms(p_seller_namespace,p_sku,p_company_id,
        p_expected_current_version_id,p_change_reason,p_periods);
$$;
