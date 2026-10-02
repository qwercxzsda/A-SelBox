-- Publishers share this guard before taking any financial/SKU row locks. A
-- bounded worker takes it exclusively, so state acknowledgments cannot deadlock
-- with a multi-day publication waiting to invalidate those same state rows.
create function private.lock_payout_report_inputs() returns void
language sql volatile security invoker set search_path = '' as $$
    select pg_advisory_xact_lock_shared(hashtextextended('company_payout_inputs',0));
$$;

-- Supported publishers invalidate after completing their source/SKU writes.
-- Serialize those short metadata tails so overlapping company/month sets cannot
-- lock refresh rows in opposing orders; source preparation remains concurrent.
create function private.lock_payout_refresh_requests() returns void
language sql volatile security invoker set search_path = '' as $$
    select pg_advisory_xact_lock(hashtextextended('company_payout_requests',0));
$$;

-- This source lookup is used only to bootstrap companies with no refresh state.
-- Completed companies use indexed month frontiers on later scheduler ticks.
create function private.first_payout_source_month() returns date
language sql stable security invoker set search_path = '' as $$
    select date_trunc('month',min(source_date))::date from (
        select min(t.posted_date) as source_date from private.settlement_transactions t
        where isfinite(t.posted_date)
        union all
        select min(v.settlement_start_date) from private.settlement_preprocess_versions v
        where isfinite(v.settlement_start_date)
        union all
        select min(d.activity_date) from private.data_kiosk_days d
        where d.dataset_key = 'economics' and d.current_version_id is not null
            and isfinite(d.activity_date)
        union all
        select min(r.start_date) from public.company_payout_reports r
        union all
        select min(s.month) from private.payout_report_refresh_state s
    ) dates;
$$;

create function private.ensure_payout_report_months() returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare frontier date := date_trunc('month',private.mature_cutoff_date())::date;
    source_month date; source_loaded boolean := false; item record; start_month date;
begin
    for item in
        select c.id,
            (select s.month from private.payout_report_refresh_state s where s.company_id=c.id
                order by s.month limit 1) as first_month,
            (select s.month from private.payout_report_refresh_state s where s.company_id=c.id
                and s.month <= frontier order by s.month desc limit 1) as last_month
        from public.companies c order by c.id
    loop
        if item.first_month is null then
            if not source_loaded then
                source_month := private.first_payout_source_month();
                source_loaded := true;
            end if;
            start_month := source_month;
        elsif item.first_month > frontier or item.last_month = frontier then
            continue;
        else
            start_month := (item.last_month + interval '1 month')::date;
        end if;
        -- Keep the next not-yet-mature month as pending metadata. Explicit future
        -- source months may also exist; they cannot hide gaps in the frontier.
        if start_month is not null then
            insert into private.payout_report_refresh_state (company_id,month)
            select item.id,m.month::date from generate_series(start_month::timestamp,
                greatest(start_month,frontier)::timestamp,interval '1 month') m(month)
            on conflict (company_id,month) do nothing;
        end if;
    end loop;
end;
$$;

create function private.request_payout_report_refresh(
    p_months date[], p_companies uuid[] default null
) returns void language plpgsql volatile security invoker set search_path = '' as $$
declare first_requested date; frontier date := date_trunc('month',private.mature_cutoff_date())::date;
    item record;
begin
    if p_months is null or exists (select 1 from unnest(p_months) m(month)
        where m.month is null or not isfinite(m.month) or m.month <> date_trunc('month',m.month)::date) then
        raise exception 'Payout refresh requires finite calendar months' using errcode='22023';
    end if;
    if cardinality(p_months)=0 then return; end if;
    perform private.lock_payout_report_inputs();
    perform private.lock_payout_refresh_requests();
    perform private.ensure_payout_report_months();
    select min(month) into first_requested from unnest(p_months) m(month);
    -- An older backfill extends history once, rather than rediscovering every
    -- historical company/month on each idle cron run.
    for item in
        select c.id,(select s.month from private.payout_report_refresh_state s
            where s.company_id=c.id order by s.month limit 1) as first_month
        from public.companies c where p_companies is null or c.id=any(p_companies) order by c.id
    loop
        if item.first_month > first_requested then
            insert into private.payout_report_refresh_state (company_id,month)
            select item.id,m.month::date from generate_series(first_requested::timestamp,
                least((item.first_month-interval '1 month')::date,frontier)::timestamp,
                interval '1 month') m(month)
            on conflict (company_id,month) do nothing;
        end if;
    end loop;
    insert into private.payout_report_refresh_state (company_id,month)
    select c.id,m.month from public.companies c cross join (select distinct month from unnest(p_months) m(month)) m
    where p_companies is null or c.id=any(p_companies)
    order by c.id,m.month
    on conflict (company_id,month) do update
    set requested_revision=payout_report_refresh_state.requested_revision+1,
        next_attempt_at=case when payout_report_refresh_state.requested_revision > payout_report_refresh_state.completed_revision
            then least(payout_report_refresh_state.next_attempt_at,excluded.next_attempt_at)
            else excluded.next_attempt_at end,failure_count=0;
end;
$$;

create function private.request_all_payout_report_refreshes(p_companies uuid[] default null)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
    perform private.lock_payout_report_inputs();
    perform private.lock_payout_refresh_requests();
    -- These infrequent scope changes can alter older seller/marketplace inputs.
    -- Acquisitions alone never call this function and invent no financial history.
    update private.payout_report_refresh_state
    set requested_revision=requested_revision+1,
        next_attempt_at=case when requested_revision>completed_revision
            then least(next_attempt_at,clock_timestamp()) else clock_timestamp() end,failure_count=0
    where p_companies is null or company_id=any(p_companies);
end;
$$;

create function private.refresh_company_payout_reports(p_limit integer default 10)
returns table (
    checked_count integer, created_count integer, reused_count integer, failed_count integer
)
language plpgsql volatile security invoker set search_path = '' as $$
declare latest_month date; item record; month_created integer; month_reused integer;
    failed_sqlstate text; failed_message text; ready_at timestamptz;
begin
    if p_limit is null or p_limit not between 1 and 100 then
        raise exception 'Payout refresh limit must be between 1 and 100' using errcode='22023';
    end if;
    perform private.require_read_committed();
    checked_count:=0; created_count:=0; reused_count:=0; failed_count:=0;
    if not pg_try_advisory_xact_lock(hashtextextended('company_payout_refresh',0))
        or not pg_try_advisory_xact_lock(hashtextextended('company_payout_inputs',0)) then
        return next;
        return;
    end if;
    perform private.ensure_payout_report_months();
    latest_month:=(date_trunc('month',private.mature_cutoff_date())-interval '1 month')::date;
    -- A stable bound allows the partial index to exclude future retries. Newly
    -- discovered work is eligible immediately, including within this statement.
    ready_at:=clock_timestamp();
    -- Read revisions without locking state ahead of the generator's source locks.
    for item in
        select s.company_id,s.month,s.requested_revision from private.payout_report_refresh_state s
        where s.requested_revision>s.completed_revision and s.month<=latest_month
            and s.next_attempt_at<=ready_at
        order by s.next_attempt_at,s.month,s.company_id limit p_limit
    loop
        checked_count:=checked_count+1;
        failed_sqlstate:=null; failed_message:=null;
        begin
            select count(*) filter (where generated.created),count(*) filter (where not generated.created)
            into month_created,month_reused
            from private.generate_company_payout_reports(item.company_id,item.month) generated;
            set constraints public.complete_company_payout_report immediate;
            set constraints public.complete_company_payout_report deferred;
        exception when others then
            failed_sqlstate:=sqlstate; failed_message:=left(sqlerrm,1000);
        end;
        if failed_sqlstate is null then
            update private.payout_report_refresh_state
            set completed_revision=greatest(completed_revision,item.requested_revision),
                last_attempt_at=clock_timestamp(),last_success_at=clock_timestamp(),
                last_error_sqlstate=null,last_error_message=null,failure_count=0,
                next_attempt_at=case when requested_revision>item.requested_revision
                    then least(next_attempt_at,clock_timestamp()) else clock_timestamp() end
            where company_id=item.company_id and month=item.month;
            created_count:=created_count+month_created;
            reused_count:=reused_count+month_reused;
        else
            update private.payout_report_refresh_state
            set last_attempt_at=clock_timestamp(),last_error_sqlstate=failed_sqlstate,
                last_error_message=failed_message,
                next_attempt_at=case when requested_revision>item.requested_revision then least(next_attempt_at,clock_timestamp())
                    else clock_timestamp()+least(interval '6 hours',interval '5 minutes'*power(2,least(failure_count,7))) end,
                failure_count=case when requested_revision>item.requested_revision then 0 else failure_count+1 end
            where company_id=item.company_id and month=item.month;
            failed_count:=failed_count+1;
        end if;
    end loop;
    return next;
end;
$$;
