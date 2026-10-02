-- Schema checks complement the publication, RLS and archive integration tests.
do $$
begin
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public','private') and c.relkind = 'r' and not c.relrowsecurity
    ) then raise exception 'All application tables require row level security'; end if;
    if (select provolatile from pg_proc where oid =
        'private.company_financial_totals(text,date,date,text,uuid[],text[],text)'::regprocedure
    ) <> 's' then
        raise exception 'Strict completeness checks and totals must share a statement snapshot';
    end if;
    if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'private' and c.relkind = 'r'
          and c.relname in ('settlement_transactions','data_kiosk_transactions')) <> 2 then
        raise exception 'Both source fact tables are required';
    end if;
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public','private') and c.relkind = 'v'
          and not coalesce(c.reloptions @> array['security_invoker=true'],false)
    ) then raise exception 'All financial views must preserve invoker security'; end if;
    if exists (
        select 1 from information_schema.columns where table_schema = 'private'
          and table_name in ('settlement_transactions','data_kiosk_transactions')
          and column_name in ('company_id','fee_amount','fee_rate_percent','company_amount','elaborated_quantity')
    ) then raise exception 'Ownership or fee amounts must not be stored in source facts'; end if;
    if exists (
        select 1 from information_schema.columns where table_schema = 'private'
          and table_name in ('settlement_transactions','data_kiosk_transactions')
          and column_name = 'amount' and is_nullable <> 'NO'
    ) then raise exception 'Published source facts require quantified amounts'; end if;
    if (select count(*) from information_schema.columns
        where table_schema = 'private'
          and table_name in ('settlement_transactions','data_kiosk_transactions')
          and column_name = 'category' and is_nullable = 'NO'
          and udt_schema = 'public' and udt_name = 'allocation_category') <> 2 then
        raise exception 'Both source fact tables require one named enum category';
    end if;
    if enum_range(null::public.allocation_category)::text[] is distinct from
        array['SETTLEMENT','SELBOX','DATA_KIOSK','ANALYSIS_ONLY'] then
        raise exception 'Exactly four named categories are required';
    end if;
    if has_schema_privilege('anon','private','USAGE')
        or has_table_privilege('authenticated','public.skus','INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated','public.sku_terms_versions','INSERT,UPDATE,DELETE')
        or has_function_privilege('authenticated','private.publish_sku_terms(jsonb)','EXECUTE')
        or has_function_privilege('authenticated','private.publish_company_payout_report(jsonb)','EXECUTE')
        or has_function_privilege('authenticated','private.generate_company_payout_reports(uuid,date)','EXECUTE')
        or has_function_privilege('authenticated','private.refresh_company_payout_reports(integer)','EXECUTE')
        or has_table_privilege('authenticated','private.payout_report_refresh_state','SELECT')
        or has_table_privilege('authenticated','private.settlement_acquisitions','SELECT') then
        raise exception 'Private source evidence and administrative writes must not be exposed';
    end if;
    if to_regprocedure('public.generate_company_payout_reports(uuid,date)') is not null then
        raise exception 'Monthly payouts must not have a manual generation API';
    end if;
    if to_regclass('public.account_reconciliation_details') is not null
        or to_regclass('public.account_reconciliation_totals') is not null then
        raise exception 'Current review must use the category-scoped financial review API';
    end if;
    if has_column_privilege('authenticated','public.app_accounts','access_role','INSERT')
        or has_column_privilege('authenticated','public.app_accounts','access_role','UPDATE')
        or has_column_privilege('authenticated','public.app_accounts','user_id','UPDATE') then
        raise exception 'Application access management must not promote roles or move Auth identities';
    end if;
    if exists (
        select 1 from information_schema.columns
        where table_schema in ('public','private') and column_name = 'marketplace_name'
          and (udt_schema <> 'pg_catalog' or udt_name <> 'text')
    ) then
        raise exception 'Every marketplace name projection must retain native text';
    end if;
    if exists (
        select 1 from information_schema.columns
        where table_schema in ('public','private') and column_name = 'marketplace_names'
          and (udt_schema <> 'pg_catalog' or udt_name <> '_text')
    ) then
        raise exception 'Marketplace scopes must retain native text arrays';
    end if;
end;
$$;
