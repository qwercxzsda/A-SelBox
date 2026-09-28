-- Frozen entitlement reports. Publication does not approve or execute a payment.
-- Calculated amounts can exceed the individual source-value precision bounds.
create domain private.calculated_amount as numeric
check (value::text not in ('NaN', 'Infinity', '-Infinity'));

create table public.company_payout_reports (
    id public.local_uuid primary key default private.uuid7(),
    company_id public.local_uuid not null references public.companies (id),
    seller_namespace private.nonblank,
    currency text check (currency ~ '^[A-Z]{3}$'),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    check (
        start_date = date_trunc('month', start_date)::date
        and end_date = (start_date + interval '1 month - 1 day')::date
    ),
    preprocess_version private.nonblank,
    dataset_key text not null check (dataset_key = 'economics'),
    marketplace_names text[] not null check (
        array_position(marketplace_names, null) is null
        and marketplace_names <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
        ]::text[]
    ),
    report_name private.nonblank not null,
    change_reason private.nonblank not null,
    calculation_version text not null check (calculation_version = 'v1'),
    component_count integer not null check (component_count >= 0),
    reconciliation_count integer not null check (reconciliation_count >= 0),
    settlement_version_count integer not null check (settlement_version_count >= 0),
    data_kiosk_version_count integer not null check (data_kiosk_version_count >= 0),
    terms_version_count integer not null check (terms_version_count >= 0),
    source_amount private.calculated_amount not null,
    fee_amount private.calculated_amount not null,
    company_amount private.calculated_amount not null,
    created_at timestamptz not null default clock_timestamp(),
    check (company_amount = source_amount + fee_amount),
    -- An empty company/month has no inferred seller, currency or preprocessing version.
    check (num_nonnulls(seller_namespace, currency, preprocess_version) in (0, 3)),
    check (seller_namespace is not null or (
        component_count = 0 and reconciliation_count = 0
        and source_amount = 0 and fee_amount = 0 and company_amount = 0
        and cardinality(marketplace_names) = 0
    ))
);
-- Scope lookup supports reuse and the leading company key supports FK checks.
create index company_payout_reports_scope_idx
on public.company_payout_reports (
    company_id, seller_namespace, start_date, currency, created_at desc, id desc
);
create index company_payout_reports_created_idx
on public.company_payout_reports (created_at desc nulls last, id asc);

-- These complete manifests are also the retention pins. They include empty
-- source versions and ownership inputs used to exclude other companies' rows.
create table private.payout_report_settlement_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    settlement_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, settlement_id),
    unique (report_id, version_id),
    foreign key (settlement_id, version_id)
    references private.settlement_preprocess_versions (settlement_id, id)
);

create table private.payout_report_data_kiosk_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    day_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, day_id),
    unique (report_id, version_id),
    foreign key (day_id, version_id)
    references private.data_kiosk_preprocess_versions (day_id, id)
);
create index payout_data_kiosk_version_idx
on private.payout_report_data_kiosk_versions (version_id);

create table private.payout_report_terms_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    seller_sku_id public.local_uuid not null,
    terms_version_id public.local_uuid not null,
    primary key (report_id, seller_sku_id),
    unique (report_id, terms_version_id),
    foreign key (seller_sku_id, terms_version_id)
    references public.sku_terms_versions (seller_sku_id, id)
);

create table public.company_payout_report_components (
    id public.local_uuid primary key default private.uuid7(),
    report_id public.local_uuid not null references public.company_payout_reports (id),
    row_number integer not null check (row_number > 0),
    source text not null check (source in ('SETTLEMENT', 'DATA_KIOSK')), -- noqa: RF04
    authoritative boolean not null,
    source_row_id public.local_uuid not null,
    source_version_id public.local_uuid not null,
    source_identity_id public.local_uuid not null,
    seller_sku_id public.local_uuid not null,
    terms_version_id public.local_uuid not null,
    fee_period_id public.local_uuid,
    sku private.nonblank not null,
    marketplace_name text check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    )),
    activity_date date not null,
    component_type private.nonblank not null,
    source_amount private.calculated_amount,
    quantity private.calculated_amount,
    fee_base private.calculated_amount,
    fee_rate_percent private.calculated_amount,
    fee_amount private.calculated_amount,
    company_amount private.calculated_amount,
    resolution_status text not null check (
        resolution_status in ('APPLIED', 'NOT_APPLICABLE', 'MISSING_FEE')
    ),
    check (not authoritative or (
        source_amount is not null
        and fee_amount is not null and company_amount is not null
        and resolution_status in ('APPLIED', 'NOT_APPLICABLE')
    )),
    unique (report_id, row_number),
    unique (report_id, source, source_row_id),
    foreign key (report_id, terms_version_id)
    references private.payout_report_terms_versions (report_id, terms_version_id),
    foreign key (seller_sku_id, terms_version_id)
    references public.sku_terms_versions (seller_sku_id, id),
    foreign key (terms_version_id, fee_period_id)
    references public.sku_fee_periods (terms_version_id, id),
    check (company_amount = source_amount + fee_amount),
    check (
        not authoritative or (
            resolution_status = 'NOT_APPLICABLE' and fee_base is null
            and fee_period_id is null and fee_rate_percent is null and fee_amount = 0
        )
        or (
            resolution_status = 'APPLIED' and fee_base is not null
            and fee_period_id is not null and fee_rate_percent is not null
            and fee_rate_percent between 0 and 100
            and fee_amount = -(fee_base * fee_rate_percent * 0.01)
        )
    )
);

-- Seller-wide control context, repeated per saved company report. Never sum this
-- inventory across reports or add its amounts to the company entitlement.
create table private.payout_report_reconciliation (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    row_number integer not null check (row_number > 0),
    seller_namespace private.nonblank not null,
    activity_date date not null,
    marketplace_name text,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    settlement_category_amount private.calculated_amount not null,
    selbox_category_amount private.calculated_amount not null,
    data_kiosk_settlement_control private.calculated_amount not null,
    data_kiosk_category_amount private.calculated_amount not null,
    difference private.calculated_amount not null,
    settlement_total private.calculated_amount not null,
    accounted_total private.calculated_amount not null,
    primary key (report_id, row_number),
    unique nulls not distinct (report_id, activity_date, marketplace_name, currency),
    check (difference = data_kiosk_settlement_control - data_kiosk_category_amount),
    check (
        settlement_total
        = settlement_category_amount + selbox_category_amount + data_kiosk_settlement_control
    ),
    check (
        accounted_total
        = settlement_category_amount
        + selbox_category_amount
        + data_kiosk_category_amount
        + difference
    ),
    check (accounted_total = settlement_total)
);

do $$
declare relation text;
begin
    foreach relation in array array[
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_settlement_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions', 'private.payout_report_reconciliation'
    ] loop
        execute format('alter table %s enable row level security', relation);
        execute format('revoke all on %s from public, anon, authenticated, service_role', relation);
        execute format('create trigger immutable before update or delete on %s for each row execute function private.reject_mutation()', relation);
        execute format('create trigger immutable_truncate before truncate on %s for each statement execute function private.reject_mutation()', relation);
    end loop;
end;
$$;

-- Counts describe immutable inventories, not user-entered business terms.
do $$
declare child text; count_field text;
begin
    for child, count_field in values
        ('public.company_payout_report_components', 'component_count'),
        ('private.payout_report_reconciliation', 'reconciliation_count'),
        ('private.payout_report_settlement_versions', 'settlement_version_count'),
        ('private.payout_report_data_kiosk_versions', 'data_kiosk_version_count'),
        ('private.payout_report_terms_versions', 'terms_version_count')
    loop
        execute format(
            'create trigger complete_report_insert after insert on %s referencing new table as inserted_children for each statement execute function private.guard_child_inventory(%L,%L,%L)',
            child, 'public.company_payout_reports', count_field, 'report_id');
    end loop;
end;
$$;
