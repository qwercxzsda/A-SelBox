create domain private.calculated_amount as numeric
check (value::text not in ('NaN', 'Infinity', '-Infinity'));

create table public.company_payout_reports (
    id public.local_uuid primary key default private.uuid7(),
    company_id public.local_uuid not null references public.companies (id),
    marketplace_name public.marketplace_name,
    currency text references private.currencies (code),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    change_reason private.nonblank not null,
    record_count integer not null check (record_count >= 0),
    source_version_count integer not null check (source_version_count >= 0),
    assignment_version_count integer not null check (assignment_version_count >= 0),
    source_coverage jsonb not null default '[]'::jsonb check (
        jsonb_typeof(source_coverage) = 'array'
    ),
    source_amount private.calculated_amount not null,
    fee_amount private.calculated_amount not null,
    company_amount private.calculated_amount not null,
    created_at timestamptz not null default clock_timestamp(),
    check (
        extract(day from start_date) = 1
        and end_date = (start_date + interval '1 month - 1 day')::date
    ),
    check (company_amount = source_amount + fee_amount),
    check (currency is not null or (
        record_count = 0 and source_amount = 0 and fee_amount = 0 and company_amount = 0
    ))
);
create index company_payout_reports_scope_idx on public.company_payout_reports (
    company_id, start_date, marketplace_name, currency, created_at desc, id desc
);

create table private.payout_report_source_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    unit_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, unit_id) include (version_id),
    foreign key (unit_id, version_id) references private.source_unit_versions (unit_id, id)
);
create index payout_source_version_idx on private.payout_report_source_versions (version_id);

create table private.payout_report_assignment_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    key_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, key_id) include (version_id),
    foreign key (key_id, version_id) references public.assignment_versions (key_id, id)
);
create index payout_assignment_version_idx on private.payout_report_assignment_versions (
    version_id
);

-- Pending revisions make idle checks independent of completed report history.
-- This is operational state; immutable reports remain the financial evidence.
create table private.payout_report_refresh_state (
    company_id public.local_uuid not null references public.companies (id) on delete cascade,
    month date not null check ( -- noqa: RF04
        isfinite(month) and month = date_trunc('month', month)::date
    ),
    requested_revision bigint not null default 1 check (requested_revision > 0),
    completed_revision bigint not null default 0 check (
        completed_revision >= 0 and completed_revision <= requested_revision
    ),
    next_attempt_at timestamptz not null default clock_timestamp(),
    failure_count integer not null default 0 check (failure_count >= 0),
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    last_error_sqlstate text check (last_error_sqlstate ~ '^[0-9A-Z]{5}$'),
    last_error_message text,
    last_failure_reason text check (last_failure_reason in (
        'SETUP_REQUIRED', 'SOURCE_REQUIRED', 'PROCESSING_FAILED'
    )),
    primary key (company_id, month),
    check (num_nonnulls(last_error_sqlstate, last_error_message, last_failure_reason) in (0, 3))
);

create index payout_report_refresh_pending_idx
on private.payout_report_refresh_state (next_attempt_at, month, company_id)
where requested_revision > completed_revision;
