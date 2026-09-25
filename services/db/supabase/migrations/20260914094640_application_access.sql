-- Application authorization is database state, never user-editable JWT metadata.
-- All REST users share the authenticated SQL role. Definer helpers stay private,
-- bind access to auth.uid(), and expose only their explicitly allowed projection.
-- noqa: disable=AM04
create function private.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.app_accounts a
        where a.user_id = (select auth.uid()) and a.access_role = 'operator'
    );
$$;

create function private.can_read_current_seller_sku(p_seller_sku_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.seller_skus s
        join public.sku_terms_versions v on v.seller_sku_id = s.id and v.id = s.current_terms_version_id
        join public.app_accounts a on a.company_id = v.company_id
        where s.id = p_seller_sku_id and a.user_id = (select auth.uid())
          and a.access_role = 'company_member'
    );
$$;

-- Header policies cannot query RLS-filtered facts: facts themselves need headers.
-- Return only the current source versions already visible through owned SKUs.
create function private.current_company_source_versions(p_source text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
    with owned_skus as materialized (
        select s.seller_namespace, s.sku
        from public.app_accounts a
        join public.sku_terms_versions v on v.company_id = a.company_id
        join public.seller_skus s
            on s.id = v.seller_sku_id and s.current_terms_version_id = v.id
        where a.user_id = (select auth.uid()) and a.access_role = 'company_member'
    )
    select distinct t.version_id::uuid
    from owned_skus o
    join private.settlement_transactions t
        on t.seller_namespace = o.seller_namespace and t.sku = o.sku
    join private.settlements h on h.current_version_id = t.version_id
    where p_source = 'SETTLEMENT' and t.category = 'SETTLEMENT'
    union all
    select distinct t.version_id::uuid
    from owned_skus o
    join private.data_kiosk_transactions t
        on t.seller_namespace = o.seller_namespace and t.sku = o.sku
    join private.data_kiosk_days h on h.current_version_id = t.version_id
    where p_source = 'DATA_KIOSK' and t.category <> 'SELBOX';
$$;

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
create policy seller_skus_read on public.seller_skus for select to authenticated
using ((select private.is_operator()) or private.can_read_current_seller_sku(id));
create policy terms_read on public.sku_terms_versions for select to authenticated
using (
    (select private.is_operator()) or exists (
        select 1 from public.seller_skus as s
        where
            s.id = sku_terms_versions.seller_sku_id
            and s.current_terms_version_id = sku_terms_versions.id
    )
);
create policy periods_read on public.sku_fee_periods for select to authenticated
using (terms_version_id in (select id from public.sku_terms_versions));

create policy settlement_facts_read on private.settlement_transactions
for select to authenticated using (
    (select private.is_operator()) or (
        category = 'SETTLEMENT'
        and (seller_namespace, sku) in (select
            seller_namespace,
            sku
        from public.company_skus)
        and version_id in (select current_version_id from private.settlements)
    )
);
create policy data_kiosk_facts_read on private.data_kiosk_transactions
for select to authenticated using (
    (select private.is_operator()) or (
        category <> 'SELBOX'
        and (seller_namespace, sku) in (select
            seller_namespace,
            sku
        from public.company_skus)
        and version_id in (select current_version_id from private.data_kiosk_days)
    )
);
create policy settlement_selection_read on private.settlements for select to authenticated
using (
    (select private.is_operator())
    or current_version_id in (select private.current_company_source_versions('SETTLEMENT'))
);
create policy settlement_version_reference_read on private.settlement_preprocess_versions
for select to authenticated using (
    (select private.is_operator())
    or id in (select private.current_company_source_versions('SETTLEMENT'))
);
create policy data_kiosk_selection_read on private.data_kiosk_days for select to authenticated
using (
    (select private.is_operator())
    or current_version_id in (select private.current_company_source_versions('DATA_KIOSK'))
);
create policy data_kiosk_version_reference_read on private.data_kiosk_preprocess_versions
for select to authenticated using (
    (select private.is_operator())
    or id in (select private.current_company_source_versions('DATA_KIOSK'))
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
    amazon_scope text, marketplace_name public.amazon_marketplace_name, activity_date date,
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

-- Payouts and their complete input manifests are operator-only. Company members
-- read current source allocations; a saved report does not grant historical access.
create policy payout_reports_read on public.company_payout_reports for select to authenticated
using ((select private.is_operator()));
create policy payout_components_read on public.company_payout_report_components
for select to authenticated using ((select private.is_operator()));
create policy payout_settlement_versions_read on private.payout_report_settlement_versions
for select to authenticated using ((select private.is_operator()));
create policy payout_data_kiosk_versions_read on private.payout_report_data_kiosk_versions
for select to authenticated using ((select private.is_operator()));
create policy payout_terms_versions_read on private.payout_report_terms_versions
for select to authenticated using ((select private.is_operator()));
create view public.payout_report_settlement_versions with (security_invoker = true) as
select * from private.payout_report_settlement_versions;
create view public.payout_report_data_kiosk_versions with (security_invoker = true) as
select * from private.payout_report_data_kiosk_versions;
create view public.payout_report_terms_versions with (security_invoker = true) as
select * from private.payout_report_terms_versions;

-- Operators publish one complete revision with CAS; they cannot write immutable
-- tables or choose internal IDs. Source and payout publishers stay direct-SQL only.
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

-- Explicit grants are the entire REST boundary, including Supabase default grants.
revoke all on all tables in schema public, private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.publish_sku_terms(text, text, uuid, uuid, text, jsonb)
from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant select on public.app_accounts, public.companies, public.seller_skus,
public.sku_terms_versions, public.sku_fee_periods, public.company_skus,
public.current_sku_fee_periods to authenticated;
grant insert (user_id, company_id), update (company_id) on public.app_accounts to authenticated;
grant delete on public.app_accounts to authenticated;
grant select on private.settlement_transactions, private.data_kiosk_transactions to authenticated;
-- Members need these references to join their visible rows, never report totals.
grant select (id, current_version_id) on private.settlements,
private.data_kiosk_days to authenticated;
grant select (
    id, settlement_id, preprocess_version
) on private.settlement_preprocess_versions to authenticated;
grant select (
    id, day_id, preprocess_version
) on private.data_kiosk_preprocess_versions to authenticated;
grant select on public.settlement_preprocess_results, public.data_kiosk_preprocess_results,
public.settlement_preprocess_entries, public.data_kiosk_preprocess_entries,
public.settlement_sku_entries, public.settlement_account_entries, public.settlement_others_entries,
public.data_kiosk_sku_entries, public.data_kiosk_account_entries, public.data_kiosk_others_entries,
public.live_company_components, private.live_company_component_inputs to authenticated;
grant select on public.company_payout_reports, public.company_payout_report_components,
private.payout_report_settlement_versions, private.payout_report_data_kiosk_versions,
private.payout_report_terms_versions, public.payout_report_settlement_versions,
public.payout_report_data_kiosk_versions, public.payout_report_terms_versions to authenticated;
grant execute on function private.is_operator(), private.can_read_current_seller_sku(uuid),
private.current_company_source_versions(text), private.read_settlement_preprocess_results(),
private.read_data_kiosk_preprocess_results(),
private.resolve_company_components(uuid[], uuid[], uuid[]),
private.publish_operator_sku_terms(text, text, uuid, uuid, text, jsonb),
public.publish_sku_terms(text, text, uuid, uuid, text, jsonb) to authenticated;

-- Apply after the application-access private revocations. Helpers remain private.
grant select on private.current_sku_terms to authenticated;
grant execute on function private.settlement_fee_applicable(text, text, text),
private.calculate_service_fee(numeric, numeric) to authenticated;
