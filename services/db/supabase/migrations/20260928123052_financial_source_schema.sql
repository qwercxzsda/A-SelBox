-- Immutable complete Finances observations; all accounts and currencies share a local day.
create table private.finances_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    api_version text not null check (api_version = '2024-06-19'),
    capture_started_at timestamptz not null,
    downloaded_at timestamptz not null check (downloaded_at >= capture_started_at),
    query_start_date date not null check (isfinite(query_start_date)),
    query_end_date date not null check (
        isfinite(query_end_date) and query_end_date >= query_start_date
    ),
    marketplace_ids text[] not null check (cardinality(marketplace_ids) > 0),
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    documents jsonb not null check (
        jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0
    ),
    created_at timestamptz not null default now()
);
create table private.finances_days (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    marketplace_name text not null check (
        marketplace_name in (
            'Amazon.com',
            'Amazon.ca',
            'Amazon.com.mx',
            'Amazon.com.br',
            'Amazon.co.uk',
            'Amazon.de',
            'Amazon.fr',
            'Amazon.it',
            'Amazon.es',
            'Amazon.nl',
            'Amazon.se',
            'Amazon.pl',
            'Amazon.com.be',
            'Amazon.ie',
            'Amazon.com.tr',
            'Amazon.ae',
            'Amazon.sa',
            'Amazon.eg',
            'Amazon.in',
            'Amazon.co.za',
            'Amazon.co.jp',
            'Amazon.com.au',
            'Amazon.sg',
            'Non-Amazon DE',
            'Non-Amazon US'
        )
    ),
    activity_date date not null check (isfinite(activity_date)),
    current_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, marketplace_name, activity_date)
);
create table private.finances_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.finances_acquisitions (id),
    day_count integer not null check (day_count > 0),
    created_at timestamptz not null default now()
);
create index finances_batches_acquisition_idx on private.finances_preprocess_batches (
    acquisition_id
);
create table private.finances_preprocess_versions (
    id public.local_uuid primary key default private.uuid7(),
    day_id public.local_uuid not null references private.finances_days (id),
    batch_id public.local_uuid not null references private.finances_preprocess_batches (id),
    preprocess_version private.nonblank not null,
    transaction_count integer not null check (transaction_count >= 0),
    row_count integer not null check (row_count >= 0),
    content_sha256 private.sha256 not null,
    diagnostics jsonb not null default '[]'::jsonb check (jsonb_typeof(diagnostics) = 'array'),
    created_at timestamptz not null default now(),
    unique (day_id, id), unique (batch_id, day_id)
);
alter table private.finances_days add constraint finances_current_version_identity
foreign key (id, current_version_id) references private.finances_preprocess_versions (day_id, id);
create table private.finances_transactions (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.finances_preprocess_versions (id),
    seller_namespace private.nonblank not null,
    native_transaction_id private.nonblank not null,
    marketplace_name text not null check (
        marketplace_name in (
            'Amazon.com',
            'Amazon.ca',
            'Amazon.com.mx',
            'Amazon.com.br',
            'Amazon.co.uk',
            'Amazon.de',
            'Amazon.fr',
            'Amazon.it',
            'Amazon.es',
            'Amazon.nl',
            'Amazon.se',
            'Amazon.pl',
            'Amazon.com.be',
            'Amazon.ie',
            'Amazon.com.tr',
            'Amazon.ae',
            'Amazon.sa',
            'Amazon.eg',
            'Amazon.in',
            'Amazon.co.za',
            'Amazon.co.jp',
            'Amazon.com.au',
            'Amazon.sg',
            'Non-Amazon DE',
            'Non-Amazon US'
        )
    ),
    marketplace_id private.nonblank not null,
    account_type private.nonblank not null,
    transaction_type private.nonblank not null,
    transaction_status text not null check (
        transaction_status in ('DEFERRED', 'DEFERRED_RELEASED', 'RELEASED')
    ),
    posted_date date not null,
    posted_at timestamptz not null,
    deferred_transaction_id text check (length(btrim(deferred_transaction_id)) > 0),
    release_transaction_id text check (length(btrim(release_transaction_id)) > 0),
    total_amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    activity_eligible boolean not null,
    source_page_number integer not null check (source_page_number > 0),
    source_record_number integer not null check (source_record_number > 0),
    component_count integer not null check (component_count >= 0),
    source_fields jsonb not null check (jsonb_typeof(source_fields) = 'object'),
    created_at timestamptz not null default now(),
    unique (version_id, id), unique (version_id, native_transaction_id)
);
create index finances_transactions_native_id_idx on private.finances_transactions (
    seller_namespace, native_transaction_id, version_id
);
create index finances_transactions_release_idx on private.finances_transactions
(release_transaction_id, version_id) where release_transaction_id is not null;
-- Publication validation only: identify releases using either direction in the batch.
-- Reads use stored activity_eligible, even if an unpinned counterpart is later pruned.
create function private.finances_activity_eligible(
    p_kind text, p_deferred_transaction_id text, p_native_transaction_id text, p_batch_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
 select p_kind<>'Transfer' and p_deferred_transaction_id is null and not exists(
  select 1 from private.finances_transactions original
  join private.finances_preprocess_versions v on v.id=original.version_id
  where v.batch_id=p_batch_id and original.release_transaction_id=p_native_transaction_id
 );
$$;

create table private.finances_transaction_components (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.finances_preprocess_versions (id),
    transaction_id public.local_uuid not null,
    native_transaction_id private.nonblank not null,
    deferred_transaction_id text check (length(btrim(deferred_transaction_id)) > 0),
    release_transaction_id text check (length(btrim(release_transaction_id)) > 0),
    seller_namespace private.nonblank not null,
    source_page_number integer not null check (source_page_number > 0),
    source_record_number integer not null check (source_record_number > 0),
    component_key private.nonblank not null,
    category public.allocation_category not null check (
        category in ('FINANCES', 'SELBOX', 'DATA_KIOSK')
    ),
    component_type private.nonblank not null,
    accounting_subtype text check (
        accounting_subtype in ('OPERATING_EXPENSE', 'BALANCE_MOVEMENT', 'TAX_RECLASSIFICATION')
    ),
    sku text check (length(btrim(sku)) > 0),
    marketplace_name text not null check (
        marketplace_name in (
            'Amazon.com',
            'Amazon.ca',
            'Amazon.com.mx',
            'Amazon.com.br',
            'Amazon.co.uk',
            'Amazon.de',
            'Amazon.fr',
            'Amazon.it',
            'Amazon.es',
            'Amazon.nl',
            'Amazon.se',
            'Amazon.pl',
            'Amazon.com.be',
            'Amazon.ie',
            'Amazon.com.tr',
            'Amazon.ae',
            'Amazon.sa',
            'Amazon.eg',
            'Amazon.in',
            'Amazon.co.za',
            'Amazon.co.jp',
            'Amazon.com.au',
            'Amazon.sg',
            'Non-Amazon DE',
            'Non-Amazon US'
        )
    ),
    amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    quantity private.exact_numeric,
    fee_base private.exact_numeric,
    posted_date date not null,
    posted_at timestamptz not null,
    transaction_type private.nonblank not null,
    transaction_status text not null,
    account_type private.nonblank not null,
    activity_eligible boolean not null,
    breakdown_path jsonb not null check (jsonb_typeof(breakdown_path) = 'array'),
    source_fields jsonb not null check (jsonb_typeof(source_fields) = 'object'),
    created_at timestamptz not null default now(),
    foreign key (version_id, transaction_id) references private.finances_transactions (
        version_id, id
    ),
    unique (version_id, component_key),
    check (category <> 'FINANCES' or sku is not null)
);
create index finances_component_parent_idx
on private.finances_transaction_components (transaction_id);
create table private.finances_pruned_versions (
    version_id public.local_uuid primary key references private.finances_preprocess_versions (id),
    created_at timestamptz not null default now()
);
-- Parent totals and component amounts are separate representations of the same money.
create view private.finances_activity_components with (security_invoker = true) as
select * from private.finances_transaction_components -- noqa: AM04
where activity_eligible;

-- Amazon's regional Summary includes the Non-Amazon US channel in Amazon.com.
-- Native marketplace provenance stays unchanged on days, transactions and components.
create function private.finances_summary_marketplace(p_marketplace text) returns text
language sql immutable parallel safe security invoker as $$
 select case p_marketplace when 'Non-Amazon US' then 'Amazon.com' else p_marketplace end;
$$;

-- Data Kiosk has the retail store, not a separately queryable Non-Amazon US channel.
-- This controls required coverage only; native financial attribution is unchanged.
create function private.finances_data_kiosk_marketplace(p_marketplace text) returns text
language sql immutable parallel safe security invoker as $$
 select case p_marketplace when 'Non-Amazon US' then 'Amazon.com' else p_marketplace end;
$$;

create table private.finances_summary_checks (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    marketplace_name text not null check (
        marketplace_name in (
            'Amazon.com',
            'Amazon.ca',
            'Amazon.com.mx',
            'Amazon.com.br',
            'Amazon.co.uk',
            'Amazon.de',
            'Amazon.fr',
            'Amazon.it',
            'Amazon.es',
            'Amazon.nl',
            'Amazon.se',
            'Amazon.pl',
            'Amazon.com.be',
            'Amazon.ie',
            'Amazon.com.tr',
            'Amazon.ae',
            'Amazon.sa',
            'Amazon.eg',
            'Amazon.in',
            'Amazon.co.za',
            'Amazon.co.jp',
            'Amazon.com.au',
            'Amazon.sg',
            'Non-Amazon DE',
            'Non-Amazon US'
        )
    ),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    account_type private.nonblank not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    summary_amount private.exact_numeric not null,
    transaction_amount private.exact_numeric not null,
    matched boolean generated always as (summary_amount = transaction_amount) stored, -- noqa: RF04
    acquisition_id public.local_uuid not null references private.finances_acquisitions (id),
    source_page_number integer not null check (source_page_number > 0),
    source_summary_index integer not null check (source_summary_index > 0),
    version_count integer not null check (version_count > 0),
    created_at timestamptz not null default now()
);
create index finances_summary_scope_idx on private.finances_summary_checks (
    seller_namespace,
    marketplace_name,
    start_date,
    end_date,
    account_type,
    currency,
    created_at desc
);
create table private.finances_summary_check_versions (
    check_id public.local_uuid not null -- noqa: RF04
    references private.finances_summary_checks (id),
    day_id public.local_uuid not null references private.finances_days (id),
    version_id public.local_uuid not null references private.finances_preprocess_versions (id),
    primary key (check_id, day_id),
    foreign key (day_id, version_id) references private.finances_preprocess_versions (day_id, id)
);
create index finances_summary_check_versions_version_idx
on private.finances_summary_check_versions (
    version_id
);

create table private.data_kiosk_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    root_query_id private.nonblank not null,
    root_query_created_at timestamptz not null,
    schema_version private.nonblank not null,
    query_definition private.nonblank not null,
    marketplace_ids text[] not null check (cardinality(marketplace_ids) > 0),
    query_start_date date not null,
    query_end_date date not null check (query_end_date >= query_start_date),
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    downloaded_at timestamptz not null,
    documents jsonb not null check (
        jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0
    ),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, root_query_id)
);
create table private.data_kiosk_days (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    marketplace_name text not null check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon DE', 'Non-Amazon US'
    )),
    activity_date date not null,
    dataset_key private.nonblank not null,
    current_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, marketplace_name, activity_date, dataset_key)
);
create table private.data_kiosk_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.data_kiosk_acquisitions (id),
    day_count integer not null check (day_count > 0),
    created_at timestamptz not null default now()
);
create index data_kiosk_batches_acquisition_idx on private.data_kiosk_preprocess_batches (
    acquisition_id
);
create table private.data_kiosk_preprocess_versions (
    id public.local_uuid primary key default private.uuid7(),
    day_id public.local_uuid not null references private.data_kiosk_days (id),
    batch_id public.local_uuid not null references private.data_kiosk_preprocess_batches (id),
    preprocess_version private.nonblank not null,
    row_count integer not null check (row_count >= 0),
    content_sha256 private.sha256 not null,
    created_at timestamptz not null default now(),
    unique (day_id, id), unique (batch_id, day_id)
);
alter table private.data_kiosk_days add constraint data_kiosk_current_version_identity
foreign key (id, current_version_id) references private.data_kiosk_preprocess_versions (day_id, id);
-- UNIQUE(batch_id, day_id) also serves batch inventory counts and FK lookups.
create table private.data_kiosk_transactions (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.data_kiosk_preprocess_versions (id),
    seller_namespace private.nonblank not null,
    marketplace_name text not null check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon DE', 'Non-Amazon US'
    )),
    activity_date date not null,
    component_key private.nonblank not null,
    sku text check (length(btrim(sku)) > 0),
    category public.allocation_category not null,
    component_type private.nonblank not null,
    amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    quantity private.exact_numeric,
    fee_base private.exact_numeric,
    native_dimensions jsonb not null check (jsonb_typeof(native_dimensions) = 'object'),
    source_document_id text,
    source_line_number integer not null check (source_line_number > 0),
    created_at timestamptz not null default now(),
    unique (version_id, component_key),
    constraint data_kiosk_allocated_requires_sku
    check (category <> 'DATA_KIOSK' or sku is not null),
    constraint data_kiosk_account_requires_blank_sku
    check (category <> 'SELBOX' or sku is null)
);
create table private.data_kiosk_pruned_versions (
    version_id public.local_uuid primary key references private.data_kiosk_preprocess_versions (id),
    created_at timestamptz not null default now()
);
