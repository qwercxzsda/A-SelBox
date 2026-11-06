-- The database chooses source versions and computes amounts for each company month.
-- Reuse an immutable report when its scope and complete input versions match.
create function private.generate_company_payout_reports(p_company_id uuid, p_month date)
returns table (report_id uuid, created boolean)
language plpgsql volatile security invoker set search_path = '' as $$
declare month_end date; scope record;
    requested_report_id uuid; seller_namespaces text[]; locked_seller text;
begin
    perform private.require_read_committed();
    month_end := private.payout_month_end(p_month);
    if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
        raise exception 'A valid company is required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    if not private.payout_company_eligible(p_company_id) then return; end if;
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
        'company_payout_month',p_company_id,p_month
    )::text,0));
    -- Fix membership once; concurrent assignments to another seller are included
    -- on the next request, without changing this request's natural lock order.
    seller_namespaces := private.payout_company_sellers(p_company_id);
    foreach locked_seller in array seller_namespaces loop
        perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
            'company_payout_report',locked_seller,p_month
        )::text,0));
    end loop;
    for scope in
        -- Ownership and scope discovery need each SKU/marketplace/currency once;
        -- the publisher still resolves every original monetary component.
        with source_scopes as (
            select t.sku,t.marketplace_name,t.currency
            from private.finances_activity_components t
            join private.finances_days s on s.current_version_id = t.version_id
            where t.posted_date between p_month and month_end and t.category = 'FINANCES'
                and t.seller_namespace = any(seller_namespaces)
            union
            select t.sku,t.marketplace_name,t.currency
            from private.data_kiosk_transactions t
            join private.data_kiosk_days d on d.current_version_id = t.version_id
            where t.activity_date between p_month and month_end and t.category = 'DATA_KIOSK'
                and t.seller_namespace = any(seller_namespaces)
        ), resolved_owners as materialized (
            -- Scope discovery and completeness use the same selected facts and
            -- ownership lookup, including rows belonging to other companies.
            select s.marketplace_name,s.currency,o.company_id
            from source_scopes s left join private.current_sku_terms o on o.sku = s.sku
        ), scopes as (
            select marketplace_name,currency from resolved_owners
            where company_id = p_company_id
            union
            -- A removed scope needs a new zero aggregate, not a stale nonzero latest report.
            select r.marketplace_name,r.currency from public.company_payout_reports r
            where r.company_id = p_company_id and r.start_date = p_month
                and r.currency is not null
        )
        -- An assigned company still has an empty scope before its first sale.
        select scopes.marketplace_name,scopes.currency,
            exists(select 1 from resolved_owners where company_id is null) as missing_ownership
        from (values (p_company_id)) company(id) left join scopes on true
        order by scopes.marketplace_name nulls first,scopes.currency
    loop
        -- Reject unowned facts even when only the fallback empty scope exists.
        if scope.missing_ownership then
            raise exception 'Unresolved ownership or fee coverage prevents a complete payout report' using errcode = '23514';
        end if;
        requested_report_id := private.uuid7();
        report_id := private.publish_company_payout_report(jsonb_build_object(
            'id',requested_report_id,'company_id',p_company_id,
            'marketplace_name',scope.marketplace_name,
            'currency',scope.currency,'start_date',p_month,'end_date',month_end,
            'dataset_key','economics','captured_seller_namespaces',seller_namespaces,
            'report_name',to_char(p_month,'YYYY-MM') || ' payout report',
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

-- Operational readiness is a bounded metadata read, never a re-run of payout calculation.
-- The private reader exposes only the caller's companies and sanitized reason codes.
create function private.read_payout_readiness(
    p_month date, p_company_ids uuid[], p_limit integer, p_offset bigint
) returns table (
    company_id uuid, company_name text, month date, status text, reason text,
    has_report boolean, last_success_at timestamptz, next_attempt_at timestamptz
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
    ), readiness as (
        select c.id,c.name,c.eligible,
            s.requested_revision>s.completed_revision as refresh_pending,
            s.failure_count,s.last_error_message,s.last_success_at,s.next_attempt_at,
            r.has_report,r.has_activity
        from companies c
        left join private.payout_report_refresh_state s on s.company_id=c.id and s.month=p_month
        cross join lateral (
            select count(*)>0 as has_report,
                coalesce(bool_or(r.component_count>0),false) as has_activity
            from public.latest_company_payout_reports r
            where r.company_id=c.id and r.start_date=p_month
        ) r
    )
    select r.id::uuid,r.name,p_month,
        case
            when p_month>=frontier then 'IMMATURE'
            when r.refresh_pending and r.failure_count>0 then 'BLOCKED'
            when r.refresh_pending then
                case when r.has_report then 'UPDATING' else 'PENDING' end
            when r.has_report then case when r.has_activity then 'COMPLETE' else 'NO_ACTIVITY' end
            when r.eligible then 'PENDING'
            else 'NOT_SCHEDULED'
        end,
        case
            when p_month>=frontier then null
            when r.refresh_pending and r.failure_count>0 then
                case when r.last_error_message like 'Unresolved ownership%' then 'SETUP_REQUIRED'
                    when r.last_error_message ilike '%coverage%' then 'SOURCE_REQUIRED'
                    else 'PROCESSING_FAILED' end
            when not r.has_report and not r.eligible then 'NO_ASSIGNED_SKUS'
            else null
        end,
        r.has_report,r.last_success_at,
        case when r.refresh_pending and p_month<frontier
            then r.next_attempt_at else null end
    from readiness r order by r.name,r.id;
end;
$$;

create function public.payout_readiness(
    p_month date, p_company_ids uuid[] default null, p_limit integer default 25,
    p_offset bigint default 0
) returns table (
    company_id uuid, company_name text, month date, status text, reason text,
    has_report boolean, last_success_at timestamptz, next_attempt_at timestamptz
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
declare sellers text[]; month_end date;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode='42501';
    end if;
    if p_company_id is null or not exists(select 1 from public.companies c where c.id=p_company_id)
        or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then
        raise exception 'Choose a valid company and bounded blocker page' using errcode='22023';
    end if;
    month_end:=private.payout_month_end(p_month);
    sellers:=private.payout_company_sellers(p_company_id);
    return query select c.sku::text,c.resolution_status,c.marketplace_name,
        min(c.activity_date),max(c.activity_date),count(*)
    from public.live_company_components c
    where c.activity_date between p_month and month_end
        and c.seller_namespace=any(sellers) and c.authoritative and c.category<>'SELBOX'
        and (c.resolution_status='MISSING_OWNERSHIP'
            or (c.resolution_status='MISSING_FEE' and c.company_id=p_company_id))
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
