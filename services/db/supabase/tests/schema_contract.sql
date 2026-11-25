-- Schema checks complement the publication, RLS and archive integration tests.
do $$
begin
    if enum_range(null::public.app_access_role)::text[] is distinct from
        array['administrator','member','unassigned'] then
        raise exception 'Application roles must use the canonical access names';
    end if;
    if (select array_agg(conrelid::regclass::text order by conrelid::regclass::text)
        from pg_constraint where contype = 'f' and confrelid = 'public.companies'::regclass
    ) is distinct from array['app_accounts','assignment_versions','company_payout_reports',
        'private.payout_report_refresh_state'] then
        raise exception 'Company deletion reasons must cover every company foreign key';
    end if;
    if not has_function_privilege('authenticated','public.delete_company(uuid)','EXECUTE')
        or has_function_privilege('anon','public.delete_company(uuid)','EXECUTE')
        or has_function_privilege('service_role','public.delete_company(uuid)','EXECUTE') then
        raise exception 'Company deletion requires an authenticated, administrator-gated RPC';
    end if;
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public','private') and c.relkind = 'r' and not c.relrowsecurity
    ) then raise exception 'All application tables require row level security'; end if;
    if exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public','private') and c.relkind = 'v'
          and not coalesce(c.reloptions @> array['security_invoker=true'],false)
    ) then raise exception 'All financial views must preserve invoker security'; end if;
    if exists (
        select 1 from information_schema.columns where table_schema = 'private'
          and table_name in ('finances_amounts','ad_invoice_lines','storage_rows','aged_storage_rows','removal_order_rows')
          and column_name in ('company_id','fee_rate_percent','company_amount','elaborated_quantity')
    ) then raise exception 'Ownership or fee amounts must not be stored in source facts'; end if;
    if exists (
        select 1 from information_schema.columns where table_schema = 'private'
          and table_name in ('finances_amounts','ad_invoice_lines','storage_rows','aged_storage_rows','removal_order_rows')
          and column_name = 'amount' and is_nullable <> 'NO'
    ) then raise exception 'Published source facts require quantified amounts'; end if;
    if to_regclass('private.source_unit_versions') is null then
        raise exception 'Reference versions are required';
    end if;
    if exists (
        select 1 from unnest(array[
            'public.financial_review_months(text,integer)',
            'public.financial_outcome_page(text,date,text,text,text,integer,bigint)'
        ]) as api(signature)
        where to_regprocedure(api.signature) is null
           or not has_function_privilege('authenticated', api.signature, 'EXECUTE')
           or has_function_privilege('anon', api.signature, 'EXECUTE')
    ) or exists (
        select 1 from unnest(array[
            'private.read_financial_review_months(text,integer)',
            'private.read_financial_outcome_page(text,date,text,text,text,integer,bigint)'
        ]) as reader(signature)
        left join pg_proc p on p.oid = to_regprocedure(reader.signature)
        where not coalesce(p.prosecdef, false)
           or pg_get_functiondef(p.oid) not like '%private.is_administrator()%'
    ) or has_function_privilege('authenticated', 'private.monthly_outcomes(date,date,text)', 'EXECUTE') then
        raise exception 'Financial review must be read through its administrator-gated RPCs';
    end if;
    if pg_get_functiondef(
        'private.read_financial_outcome_page(text,date,text,text,text,integer,bigint)'::regprocedure
    ) not like '%private.difference_reasons()%private.selbox_group%' then
        raise exception 'Financial review pages must reject reason and group codes the database does not define';
    end if;
    if (select count(*) from information_schema.columns
        where table_schema = 'private' and table_name = 'storage_rows'
          and column_name in ('average_quantity_on_hand','product_size_tier','estimated_total_item_volume',
              'volume_units','storage_rate','base_rate','utilization_surcharge_rate',
              'storage_utilization_ratio','est_vol_for_sus','est_base_msf','est_sus')) <> 11
        or not exists (
            select 1 from pg_constraint where conrelid = 'private.storage_rows'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%(storage_rate IS NULL) = (base_rate IS NOT NULL)%'
        ) or not exists (
            select 1 from pg_constraint where conrelid = 'private.storage_rows'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%est_base_msf%+%est_sus%-%fee_amount%'
        ) then
        raise exception 'Monthly storage rows must keep Amazon''s quantity, volume, one rate form and fee split';
    end if;
    if not exists (
        select 1 from pg_constraint where conrelid = 'private.removal_order_rows'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%Disposal%disposed_quantity IS NOT NULL%shipped_quantity IS NULL%'
    ) then
        raise exception 'Removal order rows must state the quantity of their order type';
    end if;
    if has_schema_privilege('anon','private','USAGE')
        or has_table_privilege('authenticated','public.assignment_keys','INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated','public.companies','INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated','public.assignment_versions','INSERT,UPDATE,DELETE')
        or has_function_privilege('authenticated','private.publish_sku_terms(jsonb)','EXECUTE')
        or has_function_privilege('authenticated','private.publish_company_payout_report(jsonb)','EXECUTE')
        or has_function_privilege('authenticated','private.generate_company_payout_reports(uuid,date)','EXECUTE')
        or has_function_privilege('authenticated','private.refresh_company_payout_reports(integer)','EXECUTE')
        or has_table_privilege('authenticated','private.payout_report_refresh_state','SELECT')
        or has_table_privilege('authenticated','private.source_acquisitions','SELECT') then
        raise exception 'Private source evidence and administrative writes must not be exposed';
    end if;
    if to_regprocedure('public.generate_company_payout_reports(uuid,date)') is not null then
        raise exception 'Monthly payouts must not have a manual generation API';
    end if;
    if has_column_privilege('authenticated','public.app_accounts','access_role','INSERT')
        or has_column_privilege('authenticated','public.app_accounts','access_role','UPDATE')
        or has_any_column_privilege('authenticated','public.app_accounts','INSERT,UPDATE')
        or has_table_privilege('authenticated','public.app_accounts','DELETE')
        or has_function_privilege('authenticated','private.set_administrator_access(uuid,boolean)','EXECUTE')
        or has_function_privilege('service_role','private.set_administrator_access(uuid,boolean)','EXECUTE') then
        raise exception 'Application access management must not promote roles or move Auth identities';
    end if;
    if exists (
        select 1 from information_schema.columns
        where table_schema in ('public','private') and column_name = 'marketplace_name'
          and (udt_schema <> 'pg_catalog' or udt_name <> 'text')
    ) then
        raise exception 'Every marketplace name projection must retain native text';
    end if;
    if to_regclass('public.assignment_status') is not null
        or not has_function_privilege('authenticated','public.reference_assignments()','EXECUTE')
        or has_function_privilege('anon','public.reference_assignments()','EXECUTE')
        or has_table_privilege('authenticated','private.assignment_candidates','SELECT')
        or has_table_privilege('authenticated','private.reference_charges','SELECT') then
        raise exception 'Assignments must be read only through the caller-bound reference_assignments RPC';
    end if;
    if exists (
        select 1 from unnest(array['current_ad_invoices','current_ad_invoice_lines','current_storage_rows',
            'current_aged_storage_rows','current_removal_order_rows']) as raw(name)
        left join pg_class c on c.relname = raw.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
        where c.oid is null
           or not has_table_privilege('authenticated', c.oid, 'SELECT')
           or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
           or has_table_privilege('anon', c.oid, 'SELECT')
           or pg_get_viewdef(c.oid) not like '%private.is_administrator()%'
    ) then
        raise exception 'Raw data views must be administrator-gated reads for signed-in accounts only';
    end if;
end;
$$;
