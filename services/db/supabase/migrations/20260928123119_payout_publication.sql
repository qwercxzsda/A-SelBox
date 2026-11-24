create function private.publish_company_payout_report(p_payload jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare r public.company_payout_reports; previous public.company_payout_reports;
    sources uuid[]; assignments uuid[]; missing_fee boolean;
begin
    perform private.require_read_committed();
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    if jsonb_typeof(p_payload) is distinct from 'object' or not p_payload ?& array[
        'id','company_id','marketplace_name','currency','start_date','end_date','change_reason']
        or exists(select 1 from jsonb_object_keys(p_payload) field where field<>all(array[
            'id','company_id','marketplace_name','currency','start_date','end_date','change_reason'])) then
        raise exception 'Invalid payout publication scope' using errcode='23514';
    end if;
    r:=jsonb_populate_record(null::public.company_payout_reports,p_payload);
    if r.id is null or r.company_id is null or r.end_date is distinct from private.payout_month_end(r.start_date)
        or r.change_reason is null then
        raise exception 'An eligible company and a full month are required' using errcode='23514';
    end if;
    if not private.payout_month_eligible(r.company_id,r.start_date) then
        raise exception 'Payout reports require a current assignment or an issued report for that month' using errcode='23514';
    end if;
    if (r.currency is null)<>(r.marketplace_name is null) then
        raise exception 'Provide both marketplace and currency for a monetary scope' using errcode='23514';
    end if;
    r.source_coverage:=private.payout_finances_coverage(r.start_date,r.end_date,r.marketplace_name);
    with outcomes as materialized (
        select * from private.financial_outcomes
    ), scoped as materialized (
        select * from outcomes f where posted_date between r.start_date and r.end_date
            and (r.marketplace_name is null or (f.marketplace_name,f.currency)=(r.marketplace_name,r.currency))
    ), owned as (
        select * from scoped where outcome='COMPANY' and company_id=r.company_id
    ), reference_units as (
        -- All matching costs are dated to the earliest charge. A later month's
        -- reconciliation still reads the invoice/report and its ownership.
        select distinct u.id,u.current_version_id,c.currency,
            case when c.route in ('STORAGE','AGED_STORAGE') then c.marketplace_name end market_key
        from private.finances_component_details c join private.source_units u
            on u.source::text=c.route and u.seller_namespace=c.seller_namespace and u.amazon_scope=c.amazon_scope
            and u.unit_key=case when c.route in ('STORAGE','AGED_STORAGE')
                then to_char(c.reference_month,'YYYY-MM') else c.reference_id end
        where c.is_current and c.activity_eligible and c.route in ('AD_INVOICE','REMOVAL_ORDER','STORAGE','AGED_STORAGE')
            and c.posted_date between r.start_date and r.end_date
            and (r.marketplace_name is null or (c.marketplace_name,c.currency)=(r.marketplace_name,r.currency))
    ), dependencies as (
        select source_versions,assignment_versions from scoped
        union all select f.source_versions,f.assignment_versions
            from outcomes f join reference_units u on u.id=f.source_identity_id and u.currency=f.currency
                and (u.market_key is null or u.market_key=f.marketplace_name)
    ), source_ids as (
        select unnest(source_versions) id from dependencies
        union select current_version_id from reference_units
        union select u.current_version_id from private.source_units u
            join private.finances_transactions f on f.version_id=u.current_version_id
            where f.posted_date between r.start_date and r.end_date
                and (r.marketplace_name is null or f.marketplace_name=r.marketplace_name)
    ), assignment_ids as (
        select unnest(assignment_versions) id from dependencies
        union select k.current_version_id from public.assignment_keys k join public.assignment_versions v on v.id=k.current_version_id
            where r.currency is null and v.company_id=r.company_id
    ) select array(select id from source_ids where id is not null order by id),
        array(select id from assignment_ids where id is not null order by id),
        count(*),coalesce(sum(base_amount+tax_amount),0),coalesce(sum(fee_amount),0),coalesce(sum(company_amount),0),
        bool_or(resolution_status='MISSING_FEE')
    into sources,assignments,r.record_count,r.source_amount,r.fee_amount,r.company_amount,missing_fee from owned;
    if missing_fee then raise exception 'Company is missing service fee coverage' using errcode='23514',detail='SETUP_REQUIRED'; end if;
    if r.currency is null and r.record_count>0 then raise exception 'Monetary reports require a marketplace and currency' using errcode='23514'; end if;
    select * into previous from public.company_payout_reports h where h.company_id=r.company_id and h.start_date=r.start_date
        and h.marketplace_name is not distinct from r.marketplace_name and h.currency is not distinct from r.currency
        order by h.created_at desc,h.id desc limit 1;
    if previous.id is not null and sources=array(select version_id::uuid from private.payout_report_source_versions where report_id=previous.id order by 1)
        and assignments=array(select version_id::uuid from private.payout_report_assignment_versions where report_id=previous.id order by 1)
    then return previous.id; end if;
    insert into public.company_payout_reports(id,company_id,marketplace_name,currency,start_date,end_date,change_reason,record_count,
        source_version_count,assignment_version_count,source_coverage,source_amount,fee_amount,company_amount)
    values(r.id,r.company_id,r.marketplace_name,r.currency,r.start_date,r.end_date,r.change_reason,r.record_count,
        cardinality(sources),cardinality(assignments),r.source_coverage,r.source_amount,r.fee_amount,r.company_amount);
    insert into private.payout_report_source_versions select r.id,v.unit_id,v.id from private.source_unit_versions v where v.id=any(sources);
    insert into private.payout_report_assignment_versions select r.id,v.key_id,v.id from public.assignment_versions v where v.id=any(assignments);
    return r.id;
end;
$$;
