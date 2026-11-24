-- The database chooses source versions and computes amounts for each company month.
-- Reuse an immutable report when its scope and complete input versions match.
create function private.generate_company_payout_reports(p_company_id uuid, p_month date)
returns table (report_id uuid, created boolean)
language plpgsql volatile security invoker set search_path = '' as $$
declare month_end date; scope record;
    requested_report_id uuid;
begin
    perform private.require_read_committed();
    month_end := private.payout_month_end(p_month);
    if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
        raise exception 'A valid company is required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    if not private.payout_month_eligible(p_company_id,p_month) then return; end if;
    -- The input guard keeps ownership and source selections stable across every
    -- report in this company/month, including an explicitly empty scope.
    for scope in
        with scopes as (
            select distinct marketplace_name,currency from private.company_components
            where company_id=p_company_id and activity_date between p_month and month_end
            union
            select marketplace_name,currency from public.company_payout_reports
            where company_id=p_company_id and start_date=p_month and currency is not null
        ) select s.* from (values(1)) fallback(i) left join scopes s on true
        order by marketplace_name,currency
    loop
        requested_report_id := private.uuid7();
        report_id := private.publish_company_payout_report(jsonb_build_object(
            'id',requested_report_id,'company_id',p_company_id,
            'marketplace_name',scope.marketplace_name,
            'currency',scope.currency,'start_date',p_month,'end_date',month_end,
            'change_reason','Automatically generated monthly payout report'
        ));
        created := report_id = requested_report_id;
        return next;
    end loop;
end;
$$;
create function public.payout_report_policy() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare mature_cutoff_date date := private.mature_cutoff_date();
begin
    if not private.is_administrator() and not private.is_member() then
        raise exception 'Application account access required' using errcode = '42501';
    end if;
    return jsonb_build_object('mature_cutoff_date',mature_cutoff_date,'mature_cutoff_months',2,
        'latest_month',(date_trunc('month',mature_cutoff_date)::date - interval '1 month')::date);
end;
$$;

-- Return bounded operational facts; the browser derives display statuses and messages.
-- The private reader exposes only the caller's companies and persisted reason codes.
create function private.read_payout_readiness(
    p_month date, p_company_ids uuid[], p_limit integer, p_offset bigint
) returns table (
    company_id uuid, company_name text, month date, eligible boolean, mature boolean,
    refresh_pending boolean, failure_count integer, failure_reason text,
    has_report boolean, has_activity boolean,
    last_success_at timestamptz, next_attempt_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare account public.app_accounts; frontier date;
begin
    select * into account from public.app_accounts a where a.user_id=auth.uid();
    if not found or account.access_role not in ('administrator','member') then
        raise exception 'Application account access required' using errcode='42501';
    end if;
    if p_month is null or not isfinite(p_month)
        or p_month<>date_trunc('month',p_month::timestamp)::date
        or p_limit is null or p_limit not between 1 and 100
        or p_offset is null or p_offset<0
        or (p_company_ids is not null and (cardinality(p_company_ids)>100
            or array_ndims(p_company_ids)>1 or array_position(p_company_ids,null) is not null)) then
        raise exception 'Choose a valid month and bounded company page' using errcode='22023';
    end if;
    if account.access_role='member' and exists (
        select 1 from unnest(p_company_ids) id where id is distinct from account.company_id
    ) then
        raise exception 'Company access required' using errcode='42501';
    end if;
    frontier:=date_trunc('month',private.mature_cutoff_date()::timestamp)::date;
    return query
    with companies as materialized (
        select c.id,c.name,private.payout_company_eligible(c.id) as eligible
        from public.companies c
        where (account.access_role='administrator' or c.id=account.company_id)
            and (p_company_ids is null or cardinality(p_company_ids)=0 or c.id=any(p_company_ids))
        order by c.name,c.id limit p_limit offset p_offset
    )
    select c.id::uuid,c.name,p_month,c.eligible,p_month<frontier,
        coalesce(s.requested_revision>s.completed_revision,false),
        coalesce(s.failure_count,0),s.last_failure_reason,
        r.has_report,r.has_activity,s.last_success_at,s.next_attempt_at
    from companies c
    left join private.payout_report_refresh_state s on s.company_id=c.id and s.month=p_month
    cross join lateral (
        select count(*)>0 as has_report,
            coalesce(bool_or(r.record_count>0),false) as has_activity
        from public.latest_company_payout_reports r
        where r.company_id=c.id and r.start_date=p_month
    ) r
    order by c.name,c.id;
end;
$$;

create function public.payout_readiness(
    p_month date, p_company_ids uuid[] default null, p_limit integer default 25,
    p_offset bigint default 0
) returns table (
    company_id uuid, company_name text, month date, eligible boolean, mature boolean,
    refresh_pending boolean, failure_count integer, failure_reason text,
    has_report boolean, has_activity boolean,
    last_success_at timestamptz, next_attempt_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
    select * from private.read_payout_readiness(p_month,p_company_ids,p_limit,p_offset);
$$;

-- Load actionable setup detail only when an administrator expands one blocked company/month.
-- Reuse the live authority/ownership/fee resolver; never expose these SKUs to members.
create function private.read_payout_setup_blockers(
    p_company_id uuid, p_month date, p_limit integer, p_offset bigint
) returns table (
    sku text, reason text, marketplace_name text, first_date date, last_date date,
    component_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare month_end date;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode='42501';
    end if;
    if p_company_id is null or not exists(select 1 from public.companies c where c.id=p_company_id)
        or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
        raise exception 'Choose a valid company and bounded blocker page' using errcode='22023';
    end if;
    month_end:=private.payout_month_end(p_month);
    return query select c.sku::text,c.resolution_status,c.marketplace_name,
        min(c.activity_date),max(c.activity_date),count(*)
    from public.live_company_components c
    where c.activity_date between p_month and month_end
        and c.resolution_status='MISSING_FEE' and c.company_id=p_company_id
    group by c.sku,c.resolution_status,c.marketplace_name
    order by c.sku,c.resolution_status,c.marketplace_name limit p_limit offset p_offset;
end;
$$;

create function public.payout_setup_blockers(
    p_company_id uuid, p_month date, p_limit integer default 25, p_offset bigint default 0
) returns table (
    sku text, reason text, marketplace_name text, first_date date, last_date date,
    component_count bigint
)
language sql stable security invoker set search_path = '' as $$
    select * from private.read_payout_setup_blockers(p_company_id,p_month,p_limit,p_offset);
$$;

revoke all on function private.read_payout_readiness(date, uuid[], integer, bigint),
public.payout_readiness(date, uuid[], integer, bigint),
private.read_payout_setup_blockers(uuid, date, integer, bigint),
public.payout_setup_blockers(uuid, date, integer, bigint)
from public, anon, authenticated, service_role;
