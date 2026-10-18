-- Explicit grants are the entire REST boundary, including Supabase default grants.
revoke all on all tables in schema public, private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.payout_report_policy(), public.sku_configuration(),
public.publish_sku_configuration(jsonb, text),
public.create_company(text), public.delete_company(uuid),
public.account_directory(), public.set_company_membership(uuid, uuid, public.app_access_role, uuid),
public.financial_review_totals(date, date, public.allocation_category),
public.financial_review_type_totals(date, date, public.allocation_category, text)
from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant select on public.app_accounts, public.companies, public.skus,
public.sku_terms_versions, public.sku_fee_periods, public.company_skus,
public.current_sku_fee_periods to authenticated;
grant execute on function private.read_account_directory(), public.account_directory(),
private.create_administrator_company(text), public.create_company(text),
private.delete_administrator_company(uuid), public.delete_company(uuid),
private.set_administrator_company_membership(uuid, uuid, public.app_access_role, uuid),
public.set_company_membership(uuid, uuid, public.app_access_role, uuid)
to authenticated;
grant select on private.finances_activity_components,
private.finances_transaction_components,
private.data_kiosk_transactions to authenticated;
-- Members can read current references across companies, never report totals.
grant select (id, current_version_id) on private.finances_days,
private.data_kiosk_days to authenticated;
grant select (
    id, day_id, preprocess_version
) on private.finances_preprocess_versions to authenticated;
grant select (
    id, day_id, preprocess_version
) on private.data_kiosk_preprocess_versions to authenticated;
grant select on public.finances_preprocess_results, public.data_kiosk_preprocess_results,
public.finances_preprocess_entries, public.data_kiosk_preprocess_entries,
public.live_company_components, private.live_company_component_inputs to authenticated;
grant select on public.company_payout_reports, public.company_payout_report_components,
public.payout_report_marketplace_totals, public.latest_company_payout_reports,
private.payout_report_finances_versions, private.payout_report_data_kiosk_versions,
private.payout_report_terms_versions, public.payout_report_finances_versions,
public.payout_report_data_kiosk_versions, public.payout_report_terms_versions,
private.payout_report_reconciliation, public.payout_report_reconciliation,
public.financial_review_records,
public.payout_reconciliation_totals,
private.live_source_reconciliation, private.source_reconciliation_inputs to authenticated;
grant execute on function private.is_administrator(), private.is_member(),
private.current_owned_sku_terms(),
private.mature_cutoff_date(), private.financial_account_visible(),
private.reconciliation_group_id(text, date, text, text),
private.reconcile_source_amounts(numeric, numeric, numeric, numeric),
public.payout_report_policy(),
public.payout_readiness(date, uuid[], integer, bigint),
private.read_payout_readiness(date, uuid[], integer, bigint),
public.payout_setup_blockers(uuid, date, integer, bigint),
private.read_payout_setup_blockers(uuid, date, integer, bigint),
private.read_finances_preprocess_results(),
private.read_data_kiosk_preprocess_results(),
private.resolve_company_components(uuid[], uuid[], uuid[]),
private.resolve_source_reconciliation(uuid[], uuid[]) to authenticated;
grant execute on function private.validate_financial_review_scope(
    date, date, public.allocation_category
), public.financial_review_totals(date, date, public.allocation_category),
public.financial_review_type_totals(date, date, public.allocation_category, text)
to authenticated;
grant execute on function public.financial_source_record(text, uuid, uuid),
public.financial_source_transaction_lookup(text, integer, bigint) to authenticated;

-- Shared financial helpers remain outside the exposed schema.
grant select on private.current_sku_terms to authenticated;
grant execute on function private.calculate_service_fee(numeric, numeric) to authenticated;

grant execute on function private.read_workspace_revisions(text[]),
public.workspace_revisions(text[]) to authenticated;

grant execute on function private.validate_transaction_filters(
    date, date, uuid[], text[], text[], text[], text[], boolean
), private.validate_page_bounds(integer, bigint),
private.member_policy_covers_current_version(regclass) to authenticated;

grant execute on function public.transaction_count(
    date, date, uuid[], text[], text[], text[], text[], boolean,
    text[], text[], text[], text[], text
)
to authenticated;
grant execute on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text[], text[], text[]
) to authenticated;

grant execute on function public.transaction_page(
    integer, bigint, text, date, date, uuid[], text[],
    text[], text[], text[], boolean, boolean, text, text[], text[], text[], text[], text
) to authenticated;

grant execute on function public.source_transaction_page(
    text, integer, bigint, text, text, date, date, text[],
    text[], text[], boolean, text[], text[], text[]
) to authenticated;

grant execute on function public.payout_report_totals(
    uuid, boolean, integer, bigint
) to authenticated;

grant execute on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean, integer, bigint
) to authenticated;

grant execute on function public.sku_filter_options() to authenticated;

-- Complete SKU configuration is exposed only through caller-checked entry points.
grant execute on function private.read_sku_configuration(), public.sku_configuration(),
private.publish_administrator_sku_configuration(jsonb, text),
public.publish_sku_configuration(jsonb, text)
to authenticated;

-- Inventory publishers stay privileged. Header tables are administrator-only under
-- RLS; the guarded helper exposes just current scope timestamps to members.
grant select on private.inventory_acquisitions, private.inventory_daily_captures,
private.inventory_items, public.latest_inventory_captures,
public.latest_inventory_items to authenticated;
grant execute on function private.latest_inventory_capture_references() to authenticated;
grant execute on function public.inventory_filter_options() to authenticated;
