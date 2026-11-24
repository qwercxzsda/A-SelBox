create function private.payout_company_eligible(p_company_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
    select exists(select 1 from private.current_sku_terms where company_id=p_company_id)
        or exists(select 1 from private.current_reference_assignments where company_id=p_company_id);
$$;

create function private.payout_month_eligible(p_company_id uuid, p_month date) returns boolean
language sql stable security invoker set search_path = '' as $$
    select private.payout_company_eligible(p_company_id) or exists(
        select 1 from public.company_payout_reports where company_id=p_company_id and start_date=p_month);
$$;

create function private.payout_month_end(p_month date) returns date
language plpgsql stable security invoker set search_path = '' as $$
declare month_end date:=(p_month+interval '1 month - 1 day')::date;
begin
    if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date then
        raise exception 'Choose the first day of a calendar month' using errcode='22023';
    end if;
    if month_end>=private.mature_cutoff_date() then
        raise exception 'The selected month is not yet eligible' using errcode='22023';
    end if;
    return month_end;
end;
$$;

-- Accounts are a declared source scope. An absent day is unknown even if every
-- reference is already assigned; a successful empty Finances day is evidence.
create function private.payout_finances_coverage(p_start date, p_end date, p_marketplace text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare coverage jsonb; complete boolean;
begin
    with markets as (
        select distinct a.seller_namespace::text, m.value->>'marketplace_name' as marketplace_name
        from private.source_acquisitions a
        cross join lateral jsonb_array_elements(a.api_metadata->'coverage_marketplaces') m
        where a.reconciliation_start_date<=p_end
        union
        select distinct f.seller_namespace,f.marketplace_name from private.finances_component_details f
        where f.activity_eligible and f.is_current and f.posted_date between p_start and p_end
    ), expected as (
        select * from markets where p_marketplace is null or marketplace_name=p_marketplace
    ), covered as (
        select m.*,count(distinct d.activity_date) as days from expected m
        left join private.current_finances_reconciled_days(null,p_start,p_end,p_marketplace) d
            on (d.seller_namespace,d.marketplace_name)=(m.seller_namespace,m.marketplace_name)
        group by 1,2
    ) select coalesce(bool_and(days=p_end-p_start+1),false),
        coalesce(jsonb_agg(jsonb_build_object('source','FINANCES','seller_namespace',seller_namespace,
            'marketplace_name',marketplace_name,'start_date',p_start,'end_date',p_end)
            order by seller_namespace,marketplace_name),'[]') into complete,coverage from covered;
    if not complete then raise exception 'Incomplete reconciled Finances source coverage'
        using errcode='23514',detail='SOURCE_REQUIRED'; end if;
    return coverage;
end;
$$;
