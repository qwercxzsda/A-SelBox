-- Frozen entitlement reports. Publication does not approve or execute a payment.
-- Calculated amounts can exceed the individual source-value precision bounds.
create domain private.calculated_amount as numeric
check (value::text not in ('NaN', 'Infinity', '-Infinity'));

create table public.company_payout_reports (
    id public.local_uuid primary key default private.uuid7(),
    company_id public.local_uuid not null references public.companies (id),
    -- A null name represents an unspecified or empty marketplace scope.
    marketplace_name text check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg',
        'Non-Amazon DE', 'Non-Amazon IT', 'Non-Amazon US'
    )),
    currency text check (currency ~ '^[A-Z]{3}$'),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    check (
        start_date = date_trunc('month', start_date)::date
        and end_date = (start_date + interval '1 month - 1 day')::date
    ),
    dataset_key text not null check (dataset_key = 'economics'),
    change_reason private.nonblank not null,
    -- Count all derived detail rows; monetary totals include authoritative rows only.
    component_count integer not null check (component_count >= 0),
    finances_version_count integer not null check (finances_version_count >= 0),
    data_kiosk_version_count integer not null check (data_kiosk_version_count >= 0),
    terms_version_count integer not null check (terms_version_count >= 0),
    source_coverage jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_coverage) = 'array'),
    source_amount private.calculated_amount not null,
    fee_amount private.calculated_amount not null,
    company_amount private.calculated_amount not null,
    created_at timestamptz not null default clock_timestamp(),
    check (company_amount = source_amount + fee_amount),
    -- An empty company/month has no inferred currency.
    check (currency is not null or (
        component_count = 0
        and source_amount = 0 and fee_amount = 0 and company_amount = 0
    ))
);
-- Scope lookup supports reuse and the leading company key supports FK checks.
create index company_payout_reports_scope_idx
on public.company_payout_reports (
    company_id, start_date, marketplace_name, currency, created_at desc, id desc
);
create index company_payout_reports_created_idx
on public.company_payout_reports (created_at desc nulls last, id asc);

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

-- Reports pin immutable contents, independently of the observations that produced them.
-- Empty Finance retrieval evidence is frozen separately in the report coverage metadata.
create table private.payout_report_finances_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    transaction_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, transaction_id),
    unique (report_id, version_id),
    foreign key (transaction_id, version_id)
    references private.finances_transaction_versions (transaction_id, id)
);

create table private.payout_report_data_kiosk_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    day_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, day_id),
    unique (report_id, version_id),
    foreign key (day_id, version_id)
    references private.data_kiosk_day_versions (day_id, id)
);
create index payout_data_kiosk_version_idx
on private.payout_report_data_kiosk_versions (version_id);

create table private.payout_report_terms_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    sku_id public.local_uuid not null,
    terms_version_id public.local_uuid not null,
    primary key (report_id, sku_id),
    unique (report_id, terms_version_id),
    foreign key (sku_id, terms_version_id)
    references public.sku_terms_versions (sku_id, id)
);
