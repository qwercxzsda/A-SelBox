-- Stable transaction identities select immutable revisions from successful preprocessing runs.
create table private.finances_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    api_version text not null check (api_version = '2024-06-19'),
    capture_started_at timestamptz not null,
    downloaded_at timestamptz not null check (downloaded_at >= capture_started_at),
    posted_after timestamptz not null check (isfinite(posted_after)),
    posted_before timestamptz check (
        isfinite(posted_before) and posted_before > posted_after
    ),
    reconciliation_start_date date check (isfinite(reconciliation_start_date)),
    reconciliation_end_date date check (isfinite(reconciliation_end_date)),
    check ((reconciliation_start_date is null) = (reconciliation_end_date is null)),
    check (reconciliation_end_date >= reconciliation_start_date),
    marketplace_ids text[] not null check (cardinality(marketplace_ids) > 0),
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    documents jsonb not null check (
        jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0
    ),
    created_at timestamptz not null default now()
);

create table private.finances_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.finances_acquisitions (id),
    preprocess_version private.nonblank not null,
    transaction_count integer not null check (transaction_count >= 0),
    component_count integer not null check (component_count >= 0),
    created_at timestamptz not null default now()
);
create index finances_batches_acquisition_idx on private.finances_preprocess_batches (
    acquisition_id
);

create table private.finances_transactions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    native_transaction_id private.nonblank not null,
    current_version_id public.local_uuid,
    current_batch_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, native_transaction_id),
    check ((current_version_id is null) = (current_batch_id is null))
);

create table private.finances_transaction_versions (
    id public.local_uuid primary key default private.uuid7(),
    transaction_id public.local_uuid not null references private.finances_transactions (id),
    content_sha256 private.sha256 not null,
    posted_date date not null check (isfinite(posted_date)),
    posted_at timestamptz not null check (isfinite(posted_at)),
    marketplace_id private.nonblank not null,
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
            'Non-Amazon IT',
            'Non-Amazon US'
        )
    ),
    account_type private.nonblank not null,
    transaction_type private.nonblank not null,
    transaction_status text not null check (
        transaction_status in ('DEFERRED', 'DEFERRED_RELEASED', 'RELEASED')
    ),
    deferred_transaction_id text check (length(btrim(deferred_transaction_id)) > 0),
    release_transaction_id text check (length(btrim(release_transaction_id)) > 0),
    activity_eligible boolean not null,
    total_amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    component_count integer not null check (component_count >= 0),
    created_at timestamptz not null default now(),
    unique (transaction_id, id),
    unique (transaction_id, content_sha256)
);

create table private.finances_transaction_components (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.finances_transaction_versions (id),
    component_number integer not null check (component_number > 0),
    category public.allocation_category not null check (
        category in ('FINANCES', 'SELBOX', 'DATA_KIOSK')
    ),
    component_type private.nonblank not null,
    accounting_subtype text check (
        accounting_subtype in ('OPERATING_EXPENSE', 'BALANCE_MOVEMENT', 'TAX_RECLASSIFICATION')
    ),
    sku text check (length(btrim(sku)) > 0),
    amount private.exact_numeric not null,
    quantity private.exact_numeric,
    fee_base private.exact_numeric,
    breakdown_path text[] not null,
    item_index integer not null check (item_index >= 0),
    breakdown_indexes integer[] not null,
    created_at timestamptz not null default now(),
    unique (version_id, component_number),
    check (array_position(breakdown_path, null) is null),
    check (array_position(breakdown_indexes, null) is null)
);

create table private.finances_preprocess_batch_transactions (
    batch_id public.local_uuid not null references private.finances_preprocess_batches (id),
    transaction_id public.local_uuid not null references private.finances_transactions (id),
    version_id public.local_uuid not null,
    source_page_number integer not null check (source_page_number > 0),
    source_record_number integer not null check (source_record_number > 0),
    primary key (batch_id, transaction_id),
    unique (batch_id, transaction_id, version_id),
    foreign key (transaction_id, version_id)
    references private.finances_transaction_versions (transaction_id, id)
);
create index finances_preprocess_batch_transactions_revision_idx
on private.finances_preprocess_batch_transactions (version_id, batch_id);
alter table private.finances_transactions add constraint finances_current_observation_identity
foreign key (current_batch_id, id, current_version_id)
references private.finances_preprocess_batch_transactions (batch_id, transaction_id, version_id)
deferrable initially deferred;
create index finances_transactions_current_version_idx
on private.finances_transactions (current_version_id);
create index finances_transactions_current_batch_idx
on private.finances_transactions (current_batch_id);

-- One row per immutable component; observation locations belong to run membership.
create view private.finances_component_details with (security_invoker = true) as
select
    c.id,
    c.version_id,
    r.transaction_id,
    t.seller_namespace,
    t.amazon_scope,
    t.native_transaction_id,
    t.current_batch_id,
    r.posted_date,
    r.posted_at,
    r.marketplace_id,
    r.marketplace_name,
    r.account_type,
    r.transaction_type,
    r.transaction_status,
    r.deferred_transaction_id,
    r.release_transaction_id,
    r.activity_eligible,
    r.currency,
    c.component_number,
    c.category,
    c.component_type,
    c.accounting_subtype,
    c.sku,
    c.amount,
    c.quantity,
    c.fee_base,
    c.breakdown_path,
    c.item_index,
    c.breakdown_indexes,
    c.created_at,
    r.id = t.current_version_id as is_current
from private.finances_transaction_components as c
inner join private.finances_transaction_versions as r on c.version_id = r.id
inner join private.finances_transactions as t on r.transaction_id = t.id;

create view private.finances_activity_components with (security_invoker = true) as
select * from private.finances_component_details -- noqa: AM04
where activity_eligible;

-- Reused revisions appear once for each successful observation that includes them.
create view private.finances_batch_components with (security_invoker = true) as
select -- noqa: AM04
    d.*,
    m.batch_id,
    p.preprocess_version,
    p.acquisition_id,
    m.source_page_number,
    m.source_record_number
from private.finances_preprocess_batch_transactions as m
inner join private.finances_preprocess_batches as p on m.batch_id = p.id
inner join private.finances_component_details as d
    on (d.transaction_id, d.version_id) = (m.transaction_id, m.version_id);

-- Data Kiosk has the retail store, not a separately queryable Non-Amazon US channel.
create function private.finances_data_kiosk_marketplace(p_marketplace text) returns text
language sql immutable parallel safe security invoker as $$
 select case p_marketplace when 'Non-Amazon US' then 'Amazon.com' else p_marketplace end;
$$;

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
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg',
        'Non-Amazon DE', 'Non-Amazon IT', 'Non-Amazon US'
    )),
    activity_date date not null,
    dataset_key private.nonblank not null,
    current_version_id public.local_uuid,
    current_batch_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, marketplace_name, activity_date, dataset_key),
    check ((current_version_id is null) = (current_batch_id is null))
);
create table private.data_kiosk_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.data_kiosk_acquisitions (id),
    preprocess_version private.nonblank not null,
    day_count integer not null check (day_count > 0),
    created_at timestamptz not null default now()
);
create index data_kiosk_batches_acquisition_idx on private.data_kiosk_preprocess_batches (
    acquisition_id
);
create table private.data_kiosk_day_versions (
    id public.local_uuid primary key default private.uuid7(),
    day_id public.local_uuid not null references private.data_kiosk_days (id),
    activity_at timestamptz not null check (isfinite(activity_at)),
    row_count integer not null check (row_count >= 0),
    content_sha256 private.sha256 not null,
    created_at timestamptz not null default now(),
    unique (day_id, id), unique (day_id, content_sha256)
);
create table private.data_kiosk_day_components (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.data_kiosk_day_versions (id),
    component_key private.nonblank not null,
    sku text check (length(btrim(sku)) > 0),
    category public.allocation_category not null,
    component_type private.nonblank not null,
    amount private.exact_numeric not null,
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    quantity private.exact_numeric,
    fee_base private.exact_numeric,
    created_at timestamptz not null default now(),
    unique (version_id, component_key),
    constraint data_kiosk_allocated_requires_sku
    check (category <> 'DATA_KIOSK' or sku is not null),
    constraint data_kiosk_account_requires_blank_sku
    check (category <> 'SELBOX' or sku is null)
);
create table private.data_kiosk_preprocess_batch_days (
    id public.local_uuid primary key default private.uuid7(),
    batch_id public.local_uuid not null references private.data_kiosk_preprocess_batches (id),
    day_id public.local_uuid not null references private.data_kiosk_days (id),
    version_id public.local_uuid not null,
    unique (batch_id, day_id),
    unique (batch_id, day_id, version_id),
    foreign key (day_id, version_id)
    references private.data_kiosk_day_versions (day_id, id)
);
create index data_kiosk_batch_days_version_idx
on private.data_kiosk_preprocess_batch_days (version_id, batch_id);
create index data_kiosk_batch_days_day_idx
on private.data_kiosk_preprocess_batch_days (day_id, batch_id);
alter table private.data_kiosk_days add constraint data_kiosk_current_observation_identity
foreign key (current_batch_id, id, current_version_id)
references private.data_kiosk_preprocess_batch_days (batch_id, day_id, version_id)
deferrable initially deferred;
create index data_kiosk_days_current_batch_idx on private.data_kiosk_days (current_batch_id);

create view private.data_kiosk_component_details with (security_invoker = true) as
select -- noqa: AM04
    t.*,
    v.day_id,
    d.seller_namespace,
    d.marketplace_name,
    d.activity_date,
    v.activity_at,
    d.dataset_key,
    d.current_batch_id,
    t.version_id = d.current_version_id as is_current
from private.data_kiosk_day_components as t
inner join private.data_kiosk_day_versions as v on t.version_id = v.id
inner join private.data_kiosk_days as d on v.day_id = d.id;

create view private.data_kiosk_batch_components with (security_invoker = true) as
select -- noqa: AM04
    d.*,
    m.id as observation_id,
    m.batch_id,
    b.preprocess_version,
    b.acquisition_id
from private.data_kiosk_preprocess_batch_days as m
inner join private.data_kiosk_preprocess_batches as b on m.batch_id = b.id
inner join private.data_kiosk_component_details as d on m.version_id = d.version_id;
