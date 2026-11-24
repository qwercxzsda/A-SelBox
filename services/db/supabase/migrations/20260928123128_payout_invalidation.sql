-- Refresh prior reports and all mature months of the affected owners. A newly
-- assigned SKU may be present in ledger or order rows outside its posting month.
create function private.invalidate_payout_sku_terms(p_sku_ids uuid[]) returns void
language plpgsql set search_path = '' as $$
declare owners uuid[];
begin
    if cardinality(p_sku_ids)=0 then return; end if;
    select array(select distinct company_id::uuid from (
        select v.company_id from public.assignment_versions v where v.key_id=any(p_sku_ids)
        union all select r.company_id from private.payout_report_assignment_versions p
        join public.company_payout_reports r on r.id=p.report_id where p.key_id=any(p_sku_ids)
        union all select r.company_id from private.payout_report_source_versions p
        join public.company_payout_reports r on r.id=p.report_id
        join private.finances_amounts a on a.version_id=p.version_id and a.route='SKU'
        join public.assignment_keys k on k.kind='SKU' and k.native_id=a.sku where k.id=any(p_sku_ids)
        union all select r.company_id from private.payout_report_source_versions p
        join public.company_payout_reports r on r.id=p.report_id join private.inventory_ledger_rows l on l.version_id=p.version_id
        join public.assignment_keys k on k.kind='SKU' and k.native_id=l.sku where k.id=any(p_sku_ids)
    ) owner where company_id is not null) into owners;
    perform private.request_all_payout_report_refreshes(owners);
end;
$$;
