-- Explicit grants are the entire REST boundary, including Supabase default grants.
revoke all on all tables in schema public, private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.generate_company_payout_reports(uuid, date),
public.payout_report_policy() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant select on public.app_accounts, public.companies, public.skus,
public.sku_terms_versions, public.sku_fee_periods, public.company_skus,
public.current_sku_fee_periods to authenticated;
grant insert (user_id, company_id), update (company_id) on public.app_accounts to authenticated;
grant delete on public.app_accounts to authenticated;
grant select on private.settlement_transactions, private.data_kiosk_transactions to authenticated;
-- Members can read current references across companies, never report totals.
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
public.live_company_components, private.live_company_component_inputs to authenticated;
grant select on public.company_payout_reports, public.company_payout_report_components,
public.payout_report_marketplace_totals,
private.payout_report_settlement_versions, private.payout_report_data_kiosk_versions,
private.payout_report_terms_versions, public.payout_report_settlement_versions,
public.payout_report_data_kiosk_versions, public.payout_report_terms_versions,
private.payout_report_reconciliation, public.payout_report_reconciliation,
private.live_source_reconciliation, private.source_reconciliation_inputs to authenticated;
grant execute on function private.is_operator(), private.is_company_member(),
private.current_owned_sku_terms(),
private.mature_cutoff_date(), private.financial_account_visible(),
private.reconciliation_group_id(text, date, text, text),
private.reconcile_source_amounts(numeric, numeric, numeric, numeric),
private.generate_company_payout_reports(uuid, date),
public.generate_company_payout_reports(uuid, date), public.payout_report_policy(),
private.read_settlement_preprocess_results(),
private.read_data_kiosk_preprocess_results(),
private.resolve_company_components(uuid[], uuid[], uuid[]),
private.resolve_source_reconciliation(uuid[], uuid[]) to authenticated;

-- Shared financial helpers remain outside the exposed schema.
grant select on private.current_sku_terms to authenticated;
grant execute on function private.settlement_fee_applicable(text, text, text),
private.calculate_service_fee(numeric, numeric) to authenticated;

grant execute on function private.read_workspace_revisions(text[]),
public.workspace_revisions(text[]) to authenticated;

grant execute on function private.validate_transaction_filters(
    date, date, uuid[], text[], text[], text[], text[], boolean
), private.validate_page_bounds(integer, bigint),
private.member_policy_covers_current_version(regclass) to authenticated;

grant execute on function public.transaction_count(
    date, date, uuid[], text[], text[], text[], text[], boolean, text[], text[], text[], text[]
)
to authenticated;
grant execute on function public.source_transaction_count(
    text, date, date, text[], text[], text[], text[], text[], text[]
) to authenticated;

grant execute on function public.transaction_page(
    integer, bigint, text, date, date, uuid[], text[],
    text[], text[], text[], boolean, boolean, text, text[], text[], text[], text[]
) to authenticated;

grant execute on function public.source_transaction_page(
    text, integer, bigint, text, text, date, date, text[],
    text[], text[], boolean, text[], text[], text[]
) to authenticated;

grant execute on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean, integer, bigint
) to authenticated;

grant execute on function public.sku_filter_options() to authenticated;
