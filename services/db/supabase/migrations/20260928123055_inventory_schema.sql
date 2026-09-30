-- Daily replenishment observations are separate from financial source versions.
create table private.inventory_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    marketplace_id private.nonblank not null,
    marketplace_name text not null check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    )),
    capture_date date not null check (isfinite(capture_date)),
    report_type text not null check (report_type = 'GET_FBA_INVENTORY_PLANNING_DATA'),
    report_id private.nonblank not null,
    report_document_id private.nonblank not null,
    report_created_at timestamptz not null check (isfinite(report_created_at)),
    downloaded_at timestamptz not null check (isfinite(downloaded_at)),
    document_sha256 private.sha256 not null,
    document jsonb not null check (jsonb_typeof(document) = 'object'), -- noqa: RF04
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    created_at timestamptz not null default clock_timestamp(),
    unique (seller_namespace, amazon_scope, report_id),
    unique (seller_namespace, marketplace_name, capture_date, id)
);

create table private.inventory_daily_captures (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    marketplace_name text not null,
    capture_date date not null check (isfinite(capture_date)),
    acquisition_id public.local_uuid not null,
    preprocess_version private.nonblank not null,
    row_count integer not null check (row_count >= 0),
    diagnostics jsonb not null default '[]'::jsonb check (jsonb_typeof(diagnostics) = 'array'),
    created_at timestamptz not null default clock_timestamp(),
    unique (seller_namespace, marketplace_name, capture_date),
    foreign key (seller_namespace, marketplace_name, capture_date, acquisition_id)
    references private.inventory_acquisitions (seller_namespace, marketplace_name, capture_date, id)
);
create index inventory_captures_acquisition_idx
on private.inventory_daily_captures (acquisition_id);

create table private.inventory_items (
    capture_id public.local_uuid not null references private.inventory_daily_captures (id)
    on delete cascade,
    sku text not null check (length(btrim(sku)) > 0),
    source_line_number integer not null check (source_line_number > 0),
    snapshot_date date check (isfinite(snapshot_date)),
    available_quantity bigint check (available_quantity >= 0),
    fba_supply_quantity bigint check (fba_supply_quantity >= 0),
    inbound_quantity bigint check (inbound_quantity >= 0),
    inbound_working_quantity bigint check (inbound_working_quantity >= 0),
    inbound_shipped_quantity bigint check (inbound_shipped_quantity >= 0),
    inbound_received_quantity bigint check (inbound_received_quantity >= 0),
    reserved_quantity bigint check (reserved_quantity >= 0),
    reserved_transfer_quantity bigint check (reserved_transfer_quantity >= 0),
    reserved_processing_quantity bigint check (reserved_processing_quantity >= 0),
    reserved_customer_order_quantity bigint check (reserved_customer_order_quantity >= 0),
    unfulfillable_quantity bigint check (unfulfillable_quantity >= 0),
    sales_amount_90d numeric check (sales_amount_90d::text not in ('NaN', 'Infinity', '-Infinity')),
    units_shipped_90d bigint check (units_shipped_90d >= 0),
    currency text check (currency ~ '^[A-Z]{3}$'),
    health_status text,
    minimum_inventory_units bigint check (minimum_inventory_units >= 0),
    days_of_supply numeric check (days_of_supply::text not in ('NaN', 'Infinity', '-Infinity')),
    total_days_of_supply numeric check (
        total_days_of_supply::text not in ('NaN', 'Infinity', '-Infinity')
    ),
    recommended_ship_in_units bigint check (recommended_ship_in_units >= 0),
    recommended_ship_in_date date check (isfinite(recommended_ship_in_date)),
    recommended_action text,
    primary key (capture_id, sku),
    unique (capture_id, source_line_number),
    check (sales_amount_90d is null or currency is not null)
);
create index inventory_items_sku_capture_idx on private.inventory_items (sku, capture_id);
