-- Fresh baseline. Successful publications are complete immutable child sets.
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
create extension if not exists btree_gist with schema extensions;

create type public.amazon_marketplace_name as enum (
    'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
    'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl', 'Amazon.se',
    'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr', 'Amazon.ae',
    'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za', 'Amazon.co.jp',
    'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
);

create type public.allocation_category as enum (
    'SETTLEMENT', 'SELBOX', 'DATA_KIOSK', 'ANALYSIS_ONLY'
);

-- PostgreSQL 17 has no uuidv7(). Trusted Python writers normally supply IDs.
create function private.uuid7() returns uuid language plpgsql volatile
set search_path = '' as $$
declare microseconds bigint := floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
begin
    -- RFC 9562 sub-millisecond fraction reduces random ordering within one ms.
    -- Source publications still use the monotonic Python uuid.uuid7() generator.
    return (lpad(to_hex(microseconds / 1000), 12, '0') || '7'
        || lpad(to_hex((microseconds % 1000) * 4096 / 1000), 3, '0')
        || '8' || substr(replace(gen_random_uuid()::text, '-', ''), 2, 15))::uuid;
end;
$$;
create domain public.local_uuid as uuid
check (
    substring(value::text from 15 for 1) = '7'
    and substring(value::text from 20 for 1) in ('8', '9', 'a', 'b')
);
create domain private.nonblank as text check (length(btrim(value)) > 0);
create domain private.sha256 as text check (value ~ '^[0-9a-f]{64}$');
create domain private.exact_numeric as numeric
check (
    value::text not in ('NaN', 'Infinity', '-Infinity')
    and greatest(length(ltrim(split_part(abs(value)::text, '.', 1), '0')) + scale(value), 1) <= 1000
);

create table public.companies (
    id public.local_uuid primary key default private.uuid7(),
    name text not null check (length(btrim(name)) > 0), -- noqa: RF04
    created_at timestamptz not null default now()
);
create type public.app_access_role as enum ('operator', 'company_member');
create table public.app_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    access_role public.app_access_role not null default 'company_member',
    company_id public.local_uuid references public.companies (id),
    created_at timestamptz not null default now(),
    check (
        (access_role = 'operator' and company_id is null)
        or (access_role = 'company_member' and company_id is not null)
    )
);
create index app_accounts_company_idx on public.app_accounts (company_id);
create table public.seller_skus (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace text not null check (length(btrim(seller_namespace)) > 0),
    sku text not null check (length(btrim(sku)) > 0),
    current_terms_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (seller_namespace, sku)
);
create table public.sku_terms_versions (
    id public.local_uuid primary key default private.uuid7(),
    seller_sku_id public.local_uuid not null references public.seller_skus (id),
    company_id public.local_uuid references public.companies (id),
    version_number bigint not null check (version_number > 0),
    fee_period_count integer not null check (fee_period_count >= 0),
    change_reason text not null check (length(btrim(change_reason)) > 0),
    created_at timestamptz not null default now(),
    unique (seller_sku_id, version_number), unique (seller_sku_id, id)
);
create index sku_terms_versions_company_idx on public.sku_terms_versions (company_id);
alter table public.seller_skus add constraint sku_current_terms_identity
foreign key (id, current_terms_version_id)
references public.sku_terms_versions (seller_sku_id, id);
create table public.sku_fee_periods (
    id public.local_uuid primary key default private.uuid7(),
    terms_version_id public.local_uuid not null references public.sku_terms_versions (id),
    marketplace_name public.amazon_marketplace_name not null,
    valid_period daterange not null check (
        not isempty(valid_period) and not lower_inf(valid_period)
        and lower(valid_period) not in ('-infinity'::date, 'infinity'::date)
        and (
            upper_inf(valid_period)
            or upper(valid_period) not in ('-infinity'::date, 'infinity'::date)
        )
        and lower_inc(valid_period) and not upper_inc(valid_period)
    ),
    fee_rate_percent numeric not null check (
        fee_rate_percent >= 0 and fee_rate_percent <= 100
        and fee_rate_percent::text not in ('NaN', 'Infinity', '-Infinity')
        and scale(fee_rate_percent) <= 6
    ),
    created_at timestamptz not null default now(),
    unique (terms_version_id, id),
    exclude using gist (terms_version_id with =, marketplace_name with =, valid_period with &&)
);
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
    marketplace_name public.amazon_marketplace_name,
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
    marketplace_name public.amazon_marketplace_name not null,
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
    marketplace_name public.amazon_marketplace_name not null,
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

-- Support current ownership/version reads and exact counts. Trailing category
-- and marketplace keys cover Settlement eligibility while retaining B-tree deduplication.
create index settlement_transactions_owner_version_idx
on private.settlement_transactions (
    seller_namespace, sku, version_id, category, marketplace_name
)
where category = 'SETTLEMENT';

create index data_kiosk_transactions_owner_version_idx
on private.data_kiosk_transactions (seller_namespace, sku, version_id)
where category <> 'SELBOX';

-- Match each owned fact to its currently selected source version.
create index settlements_current_version_idx
on private.settlements (current_version_id)
where current_version_id is not null;

create index data_kiosk_days_current_version_idx
on private.data_kiosk_days (current_version_id)
where current_version_id is not null;

-- Default date pages use one B-tree per source in either direction. Full
-- coverage also serves the raw operator tabs, including historical/account rows;
-- unchanged RLS and live-query predicates still enforce their respective scopes.
create index settlement_transactions_date_id_idx
on private.settlement_transactions (posted_date asc nulls last, id asc);

create index data_kiosk_transactions_date_id_idx
on private.data_kiosk_transactions (activity_date asc nulls last, id asc);

-- UI SKU selections do not supply a seller namespace. Lead with the selected
-- SKU; retain compact date keys and B-tree deduplication instead of appending ID.
-- These narrow candidate scans; they need not satisfy the complete page order.
create index settlement_transactions_sku_date_idx
on private.settlement_transactions (sku, posted_date);

create index data_kiosk_transactions_sku_date_idx
on private.data_kiosk_transactions (sku, activity_date);

-- Exact Type selections narrow sparse component/date scopes in either source.
-- Use native text comparisons with the same collation as the existing filters.
create index settlement_transactions_type_date_idx
on private.settlement_transactions (component_type, posted_date);

create index data_kiosk_transactions_type_date_idx
on private.data_kiosk_transactions (component_type, activity_date);

-- Retain the compact Data Kiosk marketplace/date path for privileged financial
-- reads. Authenticated enum filters may stay behind the RLS security barrier.
create index data_kiosk_transactions_marketplace_date_idx
on private.data_kiosk_transactions (marketplace_name, activity_date);

create function private.reject_mutation() returns trigger language plpgsql
set search_path = '' as $$
begin
    raise exception '% is immutable', tg_table_name using errcode = '23514';
end;
$$;
-- These are evidence or permanent identities: even trusted SQL cannot rewrite them.
do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.sku_terms_versions', 'public.sku_fee_periods',
        'private.settlement_acquisitions', 'private.data_kiosk_acquisitions',
        'private.settlement_preprocess_versions', 'private.settlement_transactions',
        'private.data_kiosk_preprocess_batches', 'private.data_kiosk_preprocess_versions',
        'private.data_kiosk_pruned_versions'
    ] loop
        execute format('create trigger immutable before update or delete on %s for each row execute function private.reject_mutation()', table_name);
    end loop;
end;
$$;

do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.seller_skus', 'public.sku_terms_versions', 'public.sku_fee_periods',
        'private.data_kiosk_pruned_versions'
    ] loop
        execute format('create trigger no_truncate before truncate on %s for each statement execute function private.reject_mutation()', table_name);
    end loop;
end;
$$;

-- No signed-in or service API writer receives direct access to publication tables.
do $$
declare relation record;
begin
    for relation in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private') and c.relkind = 'r'
    loop
        execute format('alter table %I.%I enable row level security', relation.nspname, relation.relname);
        execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', relation.nspname, relation.relname);
    end loop;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
-- Objects are uploaded with immutable keys; client roles have no bucket policies.
insert into storage.buckets (id, name, public) values (
    'source-archives', 'source-archives', false
) on conflict (id) do update set public = false;
