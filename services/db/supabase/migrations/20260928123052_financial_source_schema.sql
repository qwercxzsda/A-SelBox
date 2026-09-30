create table private.settlement_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    report_id private.nonblank not null,
    report_document_id private.nonblank not null,
    report_type text not null check (report_type = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2'),
    report_created_at timestamptz not null,
    marketplace_ids text[] not null,
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    downloaded_at timestamptz not null,
    document_sha256 private.sha256 not null,
    document jsonb not null check (jsonb_typeof(document) = 'object'), -- noqa: RF04
    created_at timestamptz not null default now()
);
create index settlement_acquisition_document_idx on private.settlement_acquisitions
(seller_namespace, amazon_scope, report_document_id);
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
create table private.settlements (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    settlement_id private.nonblank not null,
    document_sha256 private.sha256 not null,
    current_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, settlement_id)
);
create table private.settlement_preprocess_versions (
    id public.local_uuid primary key default private.uuid7(),
    settlement_id public.local_uuid not null references private.settlements (id),
    acquisition_id public.local_uuid not null references private.settlement_acquisitions (id),
    preprocess_version private.nonblank not null,
    row_count integer not null check (row_count >= 0),
    settlement_start_at timestamptz not null,
    settlement_end_at timestamptz not null check (settlement_end_at >= settlement_start_at),
    deposit_at timestamptz,
    settlement_start_date date not null,
    settlement_end_date date not null check (settlement_end_date >= settlement_start_date),
    total_amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    observed_start_date date,
    observed_end_date date,
    source_line_number integer not null check (source_line_number > 0),
    diagnostics jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (settlement_id, id)
);
-- Maintained version reads use ID or Settlement identity. Acquisition parents
-- reject UPDATE/DELETE, so this FK needs no additional reverse-lookup index.
alter table private.settlements add constraint settlement_current_version_identity
foreign key (id, current_version_id) references private.settlement_preprocess_versions (
    settlement_id, id
);
create table private.settlement_transactions (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.settlement_preprocess_versions (id),
    seller_namespace private.nonblank not null,
    source_line_number integer not null check (source_line_number > 0),
    category public.allocation_category not null,
    family text, -- noqa: RF04
    component_type private.nonblank not null,
    accounting_subtype text check (
        accounting_subtype in ('OPERATING_EXPENSE', 'BALANCE_MOVEMENT', 'TAX_RECLASSIFICATION')
    ),
    sku text check (length(btrim(sku)) > 0),
    marketplace_name text check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    )),
    amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    quantity bigint check (quantity >= 0),
    posted_date date not null,
    posted_at timestamptz not null,
    transaction_type private.nonblank not null,
    amount_type private.nonblank not null,
    amount_description private.nonblank not null,
    source_fields jsonb not null check (jsonb_typeof(source_fields) = 'object'),
    created_at timestamptz not null default now(),
    unique (version_id, source_line_number),
    constraint settlement_category_valid
    check (category in ('SETTLEMENT', 'SELBOX', 'DATA_KIOSK')),
    constraint settlement_allocated_requires_sku
    check (category <> 'SETTLEMENT' or sku is not null),
    constraint settlement_account_family_requires_blank_sku
    check (category <> 'SELBOX' or family is null or sku is null),
    check (transaction_type not in ('Order', 'Refund') or marketplace_name is not null)
);
create table private.data_kiosk_days (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    marketplace_name text not null check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
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
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
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
