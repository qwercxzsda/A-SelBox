create domain private.month_start as date
check (isfinite(value) and extract(day from value) = 1);

create table private.currencies (
    code text primary key check (code ~ '^[A-Z]{3}$'),
    decimals smallint not null check (decimals between 0 and 4)
);

insert into private.currencies (code, decimals) values
('AED', 2), ('AUD', 2), ('BRL', 2), ('CAD', 2), ('EGP', 2), ('EUR', 2), ('GBP', 2),
('INR', 2), ('JPY', 0), ('MXN', 2), ('PLN', 2), ('SAR', 2), ('SEK', 2), ('SGD', 2),
('TRY', 2), ('USD', 2), ('ZAR', 2);

create type private.amazon_source as enum (
    'FINANCES', 'AD_INVOICE', 'STORAGE', 'AGED_STORAGE', 'REMOVAL_ORDER', 'INVENTORY_LEDGER',
    'CAMPAIGN', 'PROMOTION', 'SHIPMENT'
);

create table private.source_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    source private.amazon_source not null, -- noqa: RF04
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,

    api_version text,
    marketplace_ids text[],
    asked_from timestamptz check (isfinite(asked_from)),
    asked_until timestamptz check (isfinite(asked_until) and asked_until > asked_from),
    asked_id text check (length(btrim(asked_id)) > 0),

    reconciliation_start_date date check (isfinite(reconciliation_start_date)),
    reconciliation_end_date date check (isfinite(reconciliation_end_date)),

    result text not null check (result in ('ROWS', 'EMPTY', 'UNKNOWN_ID')),
    capture_started_at timestamptz not null,
    downloaded_at timestamptz not null check (downloaded_at >= capture_started_at),
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    documents jsonb not null check (
        jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0
    ),
    created_at timestamptz not null default now(),
    check (
        (source in ('AD_INVOICE', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT')) = (asked_id is not null)
    ),
    check ((source in ('AD_INVOICE', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT')) = (asked_from is null)),
    check ((reconciliation_start_date is null) = (reconciliation_end_date is null)),
    check (reconciliation_end_date >= reconciliation_start_date),
    check (source = 'FINANCES' or reconciliation_start_date is null),
    check (result <> 'UNKNOWN_ID' or asked_id is not null)
);

create table private.source_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.source_acquisitions (id),
    preprocess_version private.nonblank not null,
    unit_count integer not null check (unit_count >= 0),
    row_count integer not null check (row_count >= 0),
    created_at timestamptz not null default now()
);
create index source_batches_acquisition_idx on private.source_preprocess_batches (acquisition_id);

create table private.source_units (
    id public.local_uuid primary key default private.uuid7(),
    source private.amazon_source not null check ( -- noqa: RF04
        source in (
            'FINANCES', 'AD_INVOICE', 'STORAGE', 'AGED_STORAGE', 'REMOVAL_ORDER', 'INVENTORY_LEDGER'
        )
    ),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    unit_key private.nonblank not null,
    current_version_id public.local_uuid,
    current_batch_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (unit_key, source, seller_namespace, amazon_scope),
    unique (id, source),
    check ((current_version_id is null) = (current_batch_id is null))
);

-- The natural key also serves exact native-ID lookups. Account refreshes
-- scan this much smaller index of repeated regional scopes.
create index source_units_account_idx on private.source_units (
    source, seller_namespace, amazon_scope
);

create table private.source_unit_versions (
    id public.local_uuid primary key default private.uuid7(),
    unit_id public.local_uuid not null,
    source private.amazon_source not null, -- noqa: RF04
    content_sha256 private.sha256 not null,
    row_count integer not null check (row_count >= 0),
    created_at timestamptz not null default now(),
    foreign key (unit_id, source) references private.source_units (id, source),
    unique (unit_id, id),
    unique (unit_id, content_sha256),
    unique (id, source)
);

create table private.source_batch_units (
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    unit_id public.local_uuid not null,
    version_id public.local_uuid not null,
    document_number integer not null check (document_number > 0),
    record_number integer not null check (record_number > 0),
    primary key (batch_id, unit_id),
    unique (batch_id, unit_id, version_id),
    foreign key (unit_id, version_id) references private.source_unit_versions (unit_id, id)
);
create index source_batch_units_version_idx on private.source_batch_units (version_id);
alter table private.source_units add constraint source_units_current_observation
foreign key (current_batch_id, id, current_version_id)
references private.source_batch_units (batch_id, unit_id, version_id)
deferrable initially deferred;
create index source_units_current_version_idx on private.source_units (current_version_id);
create index source_units_current_batch_idx on private.source_units (current_batch_id);

create table private.finances_transactions (
    version_id public.local_uuid primary key,
    source private.amazon_source not null default 'FINANCES' -- noqa: RF04
    check (source = 'FINANCES'),
    posted_at timestamptz not null check (isfinite(posted_at)),
    posted_date date not null check (isfinite(posted_date)),
    marketplace_id private.nonblank not null,
    marketplace_name public.marketplace_name not null,
    account_type private.nonblank not null,
    transaction_type private.nonblank not null,
    transaction_status text not null check (
        transaction_status in ('DEFERRED', 'DEFERRED_RELEASED', 'RELEASED')
    ),
    deferred_transaction_id text check (length(btrim(deferred_transaction_id)) > 0),
    release_transaction_id text check (length(btrim(release_transaction_id)) > 0),
    is_activity boolean not null,

    customer_order_id text check (length(btrim(customer_order_id)) > 0),
    total_amount private.exact_numeric not null,
    currency text not null references private.currencies (code),
    amount_count integer not null check (amount_count >= 0),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);
create index finances_transactions_month_idx
on private.finances_transactions (posted_date, marketplace_name);
create index finances_transactions_customer_order_idx
on private.finances_transactions (customer_order_id) where customer_order_id is not null;

create type private.finances_route as enum (
    'SKU',
    'FNSKU',
    'ASIN',
    'PROMOTION',
    'SHIPMENT',
    'CUSTOMER_ORDER',
    'AD_INVOICE',
    'STORAGE',
    'AGED_STORAGE',
    'REMOVAL_ORDER',
    'SELBOX'
);
create type private.selbox_group as enum (
    'ACCOUNT_FEE', 'BALANCE_MOVEMENT', 'TAX_RECLASSIFICATION'
);
create type private.amount_part as enum ('BASE', 'TAX', 'PROMO');

create table private.finances_amounts (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.finances_transactions (version_id),
    amount_number integer not null check (amount_number > 0),
    item_index integer not null check (item_index >= 0),
    breakdown_path text[] not null check (array_position(breakdown_path, null) is null),
    breakdown_indexes integer[] not null check (array_position(breakdown_indexes, null) is null),
    amount_type private.nonblank not null,
    amount_part private.amount_part not null,
    route private.finances_route not null,
    selbox_group private.selbox_group,
    amount private.exact_numeric not null,
    quantity private.exact_numeric,
    fee_base private.exact_numeric,

    sku text check (length(btrim(sku)) > 0),
    fnsku text check (length(btrim(fnsku)) > 0),
    asin text check (length(btrim(asin)) > 0),

    reference_id text check (length(btrim(reference_id)) > 0),
    covered_month private.month_start,
    ledger_first_month private.month_start,
    ledger_last_month private.month_start,
    created_at timestamptz not null default now(),
    unique (version_id, amount_number),
    check (route <> 'SKU' or sku is not null),
    check (route <> 'FNSKU' or fnsku is not null),
    check (route <> 'ASIN' or asin is not null),
    check ((route in ('FNSKU', 'ASIN')) = (ledger_first_month is not null)),
    check ((ledger_first_month is null) = (ledger_last_month is null)),
    check (ledger_first_month <= ledger_last_month),
    check ((route in ('STORAGE', 'AGED_STORAGE')) = (covered_month is not null)),

    check (
        reference_id is null
        or route in ('PROMOTION', 'SHIPMENT', 'CUSTOMER_ORDER', 'AD_INVOICE', 'REMOVAL_ORDER')
    ),
    check (route <> 'CUSTOMER_ORDER' or reference_id is not null),
    check ((route = 'SELBOX') = (selbox_group is not null)),
    check (fee_base is null or route = 'SKU')
);
create index finances_amounts_reference_idx on private.finances_amounts (reference_id, route)
where reference_id is not null;
-- Seek to the next distinct seller SKU, then check its transaction for activity.
create index finances_amounts_sku_idx on private.finances_amounts (sku)
where sku is not null;
-- Only commission-bearing amounts contribute required dates to the fee editor.
create index finances_amounts_fee_sku_idx on private.finances_amounts (sku, version_id)
where fee_base is not null;

-- Only charges routed through another identifier need reference matching.
create index finances_indirect_version_idx on private.finances_amounts (version_id)
where route not in ('SKU', 'SELBOX');

create table private.ad_invoices (
    version_id public.local_uuid primary key,
    source private.amazon_source not null default 'AD_INVOICE' -- noqa: RF04
    check (source = 'AD_INVOICE'),
    invoice_id private.nonblank not null,
    profile_id private.nonblank not null,
    marketplace_name public.marketplace_name not null,
    invoice_status private.nonblank not null,
    invoice_date date not null,
    from_date date not null,
    to_date date not null check (to_date >= from_date),
    currency text not null references private.currencies (code),
    amount_due private.exact_numeric not null,
    tax_amount_due private.exact_numeric not null,
    tax_name text,
    tax_country text,
    tax_rate_stated private.exact_numeric not null,
    tax_rate_percent numeric not null check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
    line_count integer not null check (line_count >= 0),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);

create table private.ad_invoice_lines (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.ad_invoices (version_id),
    line_number integer not null check (line_number > 0),

    line_kind text not null check (
        line_kind in ('CAMPAIGN', 'CAMPAIGN_ADJUSTMENT', 'ACCOUNT_ADJUSTMENT')
    ),
    adjustment_kind text check (adjustment_kind in (
        'OVER_DELIVERY_AGAINST_CAMPAIGN', 'OVER_DELIVERY_CLICK_CREDITS', 'ROUNDING'
    )),

    campaign_id text check (length(btrim(campaign_id)) > 0),
    campaign_aid text check (length(btrim(campaign_aid)) > 0),
    campaign_name text,
    ad_program text check (ad_program in (
        'SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY', 'SPONSORED_TV'
    )),
    description text,
    cost_amount private.exact_numeric not null,
    base_amount private.exact_numeric not null,
    tax_amount private.exact_numeric not null,
    created_at timestamptz not null default now(),
    unique (version_id, line_number),
    check ((line_kind = 'ACCOUNT_ADJUSTMENT') = (campaign_id is null)),
    check ((line_kind = 'CAMPAIGN') = (adjustment_kind is null)),
    check ((line_kind = 'CAMPAIGN') = (ad_program is not null)),
    check (
        (line_kind = 'CAMPAIGN_ADJUSTMENT')
        = (adjustment_kind is not distinct from 'OVER_DELIVERY_AGAINST_CAMPAIGN')
    )
);
create index ad_invoice_lines_campaign_idx on private.ad_invoice_lines (campaign_id)
where campaign_id is not null;

create table private.storage_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'STORAGE' -- noqa: RF04
    check (source = 'STORAGE'),
    row_number integer not null check (row_number > 0),
    month_of_charge private.month_start not null,
    country_code private.nonblank not null,
    fulfillment_center text,
    fnsku private.nonblank not null,
    asin private.nonblank not null,
    currency text not null references private.currencies (code),
    fee_amount private.exact_numeric not null,
    marketplace_name public.marketplace_name not null,
    base_amount private.exact_numeric not null,
    tax_amount private.exact_numeric not null,
    ledger_first_month private.month_start not null,
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);

create table private.aged_storage_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'AGED_STORAGE' -- noqa: RF04
    check (source = 'AGED_STORAGE'),
    row_number integer not null check (row_number > 0),
    snapshot_at timestamptz not null check (isfinite(snapshot_at)),
    snapshot_month private.month_start not null,
    country_code private.nonblank not null,
    fnsku private.nonblank not null,
    asin private.nonblank not null,
    sku_printed text,
    condition text,
    age_tier text,
    quantity_charged private.exact_numeric,
    currency text not null references private.currencies (code),
    fee_amount private.exact_numeric not null,
    marketplace_name public.marketplace_name not null,
    base_amount private.exact_numeric not null,
    tax_amount private.exact_numeric not null,
    ledger_first_month private.month_start not null,
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);

create table private.removal_order_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'REMOVAL_ORDER' -- noqa: RF04
    check (source = 'REMOVAL_ORDER'),
    row_number integer not null check (row_number > 0),
    removal_order_id private.nonblank not null,
    requested_at timestamptz not null check (isfinite(requested_at)),
    last_updated_at timestamptz not null check (isfinite(last_updated_at)),
    order_type text not null check (order_type in ('Disposal', 'Return', 'Liquidations')),
    order_status private.nonblank not null,
    fnsku private.nonblank not null,
    sku_printed text,
    disposition text,
    requested_quantity private.exact_numeric,
    cancelled_quantity private.exact_numeric,
    disposed_quantity private.exact_numeric,
    shipped_quantity private.exact_numeric,
    in_process_quantity private.exact_numeric,
    currency text references private.currencies (code),
    fee_amount private.exact_numeric,
    base_amount private.exact_numeric,
    tax_amount private.exact_numeric,
    ledger_first_month private.month_start not null,
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source),
    check (last_updated_at >= requested_at),
    check (
        coalesce(fee_amount, 0) = 0
        or (currency is not null and base_amount is not null and tax_amount is not null)
    )
);

create table private.inventory_ledger_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'INVENTORY_LEDGER' check ( -- noqa: RF04
        source = 'INVENTORY_LEDGER'
    ),
    row_number integer not null check (row_number > 0),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    month private.month_start not null, -- noqa: RF04
    fnsku private.nonblank not null,
    sku private.nonblank not null,
    asin private.nonblank not null,
    disposition text,
    country_code text,
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);
create index inventory_ledger_fnsku_idx
on private.inventory_ledger_rows (seller_namespace, amazon_scope, fnsku, month, version_id);
create index inventory_ledger_asin_idx
on private.inventory_ledger_rows (seller_namespace, amazon_scope, asin, month, version_id);

create table private.campaigns (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    campaign_id private.nonblank not null,
    campaign_aid text,
    ad_program text check (ad_program in (
        'SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY', 'SPONSORED_TV'
    )),
    campaign_name text,
    campaign_state text,
    marketplace_name public.marketplace_name,
    start_date date,
    end_date date,
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, campaign_id)
);

create table private.campaign_products (
    campaign_row_id public.local_uuid not null references private.campaigns (id) on delete cascade,
    product_number integer not null check (product_number > 0),
    sku text check (length(btrim(sku)) > 0),
    asin text check (length(btrim(asin)) > 0),
    primary key (campaign_row_id, product_number),
    check (sku is not null or asin is not null)
);

create table private.promotions (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    promotion_id private.nonblank not null,
    promotion_type text,
    promotion_title text,
    promotion_status text,
    marketplace_name public.marketplace_name,
    starts_at timestamptz,
    ends_at timestamptz,
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, promotion_id)
);
create table private.promotion_products (
    promotion_row_id public.local_uuid not null references private.promotions (
        id
    ) on delete cascade,
    product_number integer not null check (product_number > 0),
    sku text check (length(btrim(sku)) > 0),
    asin text check (length(btrim(asin)) > 0),
    primary key (promotion_row_id, product_number),
    check (sku is not null or asin is not null)
);

create table private.shipments (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    shipment_id private.nonblank not null,
    shipment_name text,
    shipment_status text,
    destination_fulfillment_center text,
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, shipment_id)
);
create table private.shipment_items (
    shipment_row_id public.local_uuid not null references private.shipments (id) on delete cascade,
    product_number integer not null check (product_number > 0),
    sku private.nonblank not null,
    fnsku text check (length(btrim(fnsku)) > 0),
    quantity_shipped private.exact_numeric,
    quantity_received private.exact_numeric,
    primary key (shipment_row_id, product_number)
);

-- Source provenance and unrounded amounts, including non-activity order records.
create view private.finances_component_details with (security_invoker = true) as
select
    a.id,
    a.version_id,
    v.unit_id as transaction_id,
    u.seller_namespace,
    u.amazon_scope,
    u.unit_key as native_transaction_id,
    u.current_batch_id,
    t.posted_date,
    t.posted_at,
    t.marketplace_id,
    t.marketplace_name::text,
    t.customer_order_id as order_id,
    t.account_type,
    t.transaction_type,
    t.transaction_status,
    t.deferred_transaction_id,
    t.release_transaction_id,
    t.is_activity as activity_eligible,
    t.currency,
    a.amount_number as component_number,
    a.amount_type as component_type,
    a.selbox_group::text,
    a.route::text,
    a.amount_part::text,
    a.asin,
    a.fnsku,
    a.reference_id,
    a.covered_month as reference_month,
    a.ledger_first_month as ledger_start_month,
    a.ledger_last_month as ledger_end_month,
    a.sku,
    a.amount,
    a.quantity,
    a.fee_base,
    a.breakdown_path,
    a.item_index,
    a.breakdown_indexes,
    a.created_at,
    t.version_id = u.current_version_id as is_current
from private.finances_amounts as a
inner join private.finances_transactions as t on a.version_id = t.version_id
inner join private.source_unit_versions as v on t.version_id = v.id
inner join private.source_units as u on v.unit_id = u.id;

create view private.information_keys with (security_invoker = true) as
select
    'CAMPAIGN'::text as source, -- noqa: RF04
    seller_namespace,
    amazon_scope,
    campaign_id as native_key
from private.campaigns
union all
select
    'PROMOTION' as source, -- noqa: RF04
    seller_namespace,
    amazon_scope,
    promotion_id
from private.promotions
union all
select
    'SHIPMENT' as source, -- noqa: RF04
    seller_namespace,
    amazon_scope,
    shipment_id
from private.shipments;

create view private.information_products with (security_invoker = true) as
select
    'CAMPAIGN'::text as source, -- noqa: RF04
    h.seller_namespace,
    h.amazon_scope,
    h.campaign_id as native_key,
    p.sku,
    p.asin
from private.campaigns as h inner join private.campaign_products as p on h.id = p.campaign_row_id
union all
select
    'PROMOTION' as source, -- noqa: RF04
    h.seller_namespace,
    h.amazon_scope,
    h.promotion_id,
    p.sku,
    p.asin
from private.promotions as h inner join private.promotion_products as p on h.id = p.promotion_row_id
union all
select
    'SHIPMENT' as source, -- noqa: RF04
    h.seller_namespace,
    h.amazon_scope,
    h.shipment_id,
    p.sku,
    null::text as asin
from private.shipments as h inner join private.shipment_items as p on h.id = p.shipment_row_id;

create view private.reference_id_requests with (security_invoker = true) as
with requested as (
    select
        f.route as source, -- noqa: RF04
        f.seller_namespace,
        f.amazon_scope,
        f.marketplace_name,
        f.reference_id as native_key,
        b.created_at as last_referenced_at,
        null::text as profile_id,
        null::text as campaign_aid,
        null::text as ad_type
    from private.finances_component_details as f
    inner join private.source_preprocess_batches as b on f.current_batch_id = b.id
    where
        f.is_current and f.activity_eligible and f.reference_id is not null
        and f.route in ('PROMOTION', 'AD_INVOICE', 'SHIPMENT')
    union all
    select
        'CAMPAIGN' as source, -- noqa: RF04
        u.seller_namespace,
        u.amazon_scope,
        i.marketplace_name,
        l.campaign_id,
        b.created_at,
        i.profile_id,
        l.campaign_aid,
        l.ad_program
    from private.source_units as u
    inner join private.ad_invoices as i on u.current_version_id = i.version_id
    inner join private.ad_invoice_lines as l on i.version_id = l.version_id
    inner join private.source_preprocess_batches as b on u.current_batch_id = b.id
    where l.ad_program is not null
),

latest as (
    select distinct on (source, seller_namespace, amazon_scope, native_key) *
    from requested
    order by
        source asc,
        seller_namespace asc,
        amazon_scope asc,
        native_key asc,
        last_referenced_at desc,
        marketplace_name asc
)

select
    q.*,
    case
        when q.source = 'AD_INVOICE' then not exists (
            select 1
            from private.source_units as u
            inner join private.ad_invoices as i on u.current_version_id = i.version_id
            where
                u.seller_namespace = q.seller_namespace
                and u.amazon_scope = q.amazon_scope
                and u.unit_key = q.native_key
        ) else
            not exists (
                select 1 from private.information_keys as k
                where
                    (k.source, k.seller_namespace, k.amazon_scope, k.native_key)
                    = (q.source, q.seller_namespace, q.amazon_scope, q.native_key)
            )
    end as missing
from latest as q;
