-- Schema for replacing Data Kiosk: the tables, written as SQL.            24 November 2026
--
-- A DESIGN, not a migration. It says exactly which tables, columns, keys and checks there are.
-- Why they are so, how amounts are calculated from them, what a payout pins and when things run
-- is in remove-data-kiosk-schema.md. The rules behind both are in remove-data-kiosk-rules.md.
--
-- Nothing is deployed, so this is a new baseline: no existing row is carried over.
--
-- It takes the place of today's
--     private.finances_*      (6 tables)      -> sections 1 and 2
--     private.data_kiosk_*    (6 tables)      -> gone
--     public.skus, public.sku_terms_versions, public.sku_fee_periods      -> section 7
--     public.company_payout_reports, private.payout_report_*_versions     -> section 8
--     public.allocation_category                                           -> private.finances_route
-- It keeps today's, unchanged and not repeated here:
--     schema private; public.local_uuid, private.uuid7(), private.nonblank, private.sha256,
--     private.exact_numeric; public.companies, public.app_accounts;
--     private.payout_report_refresh_state, private.workspace_revision_tokens;
--     the three private.inventory_* tables of the daily inventory captures.
-- Not in this file: row-level security, grants, the triggers that reject changes to unchangeable
-- rows, the functions that store a batch or an assignment (schema.md 7), and the calculation
-- (schema.md 4).
--
-- Reading guide
--   "worked out"   the row's own preprocessing derived the value from that same Amazon source.
--   everything else on a source row is what Amazon gave.
--   seller account = seller_namespace + amazon_scope (North America, Europe, Japan, ...).
--   a month is the date of its first day.
--   a source row keeps Amazon's sign: Finances states a cost as negative, reports and invoices
--   as positive.

-- =============================================================================================
-- 0. Fixed lists
-- =============================================================================================
create domain public.marketplace_name as text check (value in (
    'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
    'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
    'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
    'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
    'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg',
    'Non-Amazon DE', 'Non-Amazon IT', 'Non-Amazon US'
));

create domain private.month_start as date
check (isfinite(value) and extract(day from value) = 1);

-- The smallest unit of each currency, and the only place that states it. The database rounds
-- the total of a key's rows with it before the total is compared with Finances (rules 3).
-- Each preprocessing run is handed the same list for the tax of a report row (rules 9).
-- Rows are added, never changed or removed.
create table private.currencies (
    code text primary key check (code ~ '^[A-Z]{3}$'),
    decimals smallint not null check (decimals between 0 and 4)       -- JPY 0, EUR 2, ...
);

create type private.amazon_source as enum (
    'FINANCES', 'AD_INVOICE', 'STORAGE', 'AGED_STORAGE', 'REMOVAL_ORDER', 'INVENTORY_LEDGER',  -- versioned
    'CAMPAIGN', 'PROMOTION', 'SHIPMENT'                                                        -- latest answer only
);

-- =============================================================================================
-- 1. Bookkeeping, shared by every Amazon source
-- =============================================================================================
-- One kept answer whose preprocessing succeeded. Amazon's answer itself stays in private storage.
create table private.source_acquisitions (
    id public.local_uuid primary key default private.uuid7(),
    source private.amazon_source not null,
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    -- What was asked: a period (posting period, month of charge, snapshot period, request dates,
    -- ledger month) or one ID (invoice, campaign, promotion, shipment).
    asked_from timestamptz check (isfinite(asked_from)),
    asked_until timestamptz check (isfinite(asked_until) and asked_until > asked_from),
    asked_id text check (length(btrim(asked_id)) > 0),
    -- Finances only, as today: the complete local days that were checked against listSummary.
    reconciliation_start_date date check (isfinite(reconciliation_start_date)),
    reconciliation_end_date date check (isfinite(reconciliation_end_date)),
    -- ROWS        Amazon gave rows
    -- EMPTY       Amazon cancelled the report for lack of data, or gave no rows
    -- UNKNOWN_ID  Amazon does not know the ID
    result text not null check (result in ('ROWS', 'EMPTY', 'UNKNOWN_ID')),
    capture_started_at timestamptz not null,
    downloaded_at timestamptz not null check (downloaded_at >= capture_started_at),
    api_metadata jsonb not null check (jsonb_typeof(api_metadata) = 'object'),
    documents jsonb not null check (                    -- where each kept document is, with length and hash
        jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0
    ),
    created_at timestamptz not null default now(),
    check ((source in ('AD_INVOICE', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT')) = (asked_id is not null)),
    check ((source in ('AD_INVOICE', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT')) = (asked_from is null)),
    check ((reconciliation_start_date is null) = (reconciliation_end_date is null)),
    check (reconciliation_end_date >= reconciliation_start_date),
    check (source = 'FINANCES' or reconciliation_start_date is null),
    check (result <> 'UNKNOWN_ID' or asked_id is not null)
);

-- One successful preprocessing of an answer. A new preprocessing version applied to a kept
-- answer is a new batch on the same acquisition: this is where a rule change is recorded.
create table private.source_preprocess_batches (
    id public.local_uuid primary key default private.uuid7(),
    acquisition_id public.local_uuid not null references private.source_acquisitions (id),
    preprocess_version private.nonblank not null,
    unit_count integer not null check (unit_count >= 0),
    row_count integer not null check (row_count >= 0),
    created_at timestamptz not null default now()
);
create index source_batches_acquisition_idx on private.source_preprocess_batches (acquisition_id);

-- What one version covers (rules 5). unit_key is:
--   FINANCES          Amazon's transaction ID
--   AD_INVOICE        the invoice ID
--   STORAGE           the month of charge, written 2026-06
--   AGED_STORAGE      the snapshot month, written 2026-06
--   REMOVAL_ORDER     the removal order ID
--   INVENTORY_LEDGER  the month, written 2026-06
-- "Loaded" means: the unit exists and has a current version. "Asked, no rows" is a version
-- without rows.
create table private.source_units (
    id public.local_uuid primary key default private.uuid7(),
    source private.amazon_source not null check (
        source in ('FINANCES', 'AD_INVOICE', 'STORAGE', 'AGED_STORAGE', 'REMOVAL_ORDER', 'INVENTORY_LEDGER')
    ),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    unit_key private.nonblank not null,
    current_version_id public.local_uuid,               -- the version in force
    current_batch_id public.local_uuid,                 -- the batch that last saw it
    created_at timestamptz not null default now(),
    unique (source, seller_namespace, amazon_scope, unit_key),
    unique (id, source),
    check ((current_version_id is null) = (current_batch_id is null))
);

-- One version of a unit. Content that did not change keeps its version: the hash covers the
-- stored columns and rows in a fixed order, and leaves out the preprocessing version, the
-- download time and the position of a row in Amazon's answer.
create table private.source_unit_versions (
    id public.local_uuid primary key default private.uuid7(),
    unit_id public.local_uuid not null,
    source private.amazon_source not null,              -- repeated, so a content table can only attach to its own source
    content_sha256 private.sha256 not null,
    row_count integer not null check (row_count >= 0),
    created_at timestamptz not null default now(),
    foreign key (unit_id, source) references private.source_units (id, source),
    unique (unit_id, id),
    unique (unit_id, content_sha256),
    unique (id, source)
);

-- Which version each batch saw, new or reused. A row's preprocessing version is read through
-- here. Finances needs it for completeness, as today.
create table private.source_batch_units (
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    unit_id public.local_uuid not null references private.source_units (id),
    version_id public.local_uuid not null,
    document_number integer not null check (document_number > 0),   -- where the unit starts in the kept answer
    record_number integer not null check (record_number > 0),
    primary key (batch_id, unit_id),
    unique (batch_id, unit_id, version_id),
    foreign key (unit_id, version_id) references private.source_unit_versions (unit_id, id)
);
create index source_batch_units_version_idx on private.source_batch_units (version_id, batch_id);
create index source_batch_units_unit_idx on private.source_batch_units (unit_id);
alter table private.source_units add constraint source_units_current_observation
foreign key (current_batch_id, id, current_version_id)
references private.source_batch_units (batch_id, unit_id, version_id)
deferrable initially deferred;
create index source_units_current_version_idx on private.source_units (current_version_id);
create index source_units_current_batch_idx on private.source_units (current_batch_id);

-- =============================================================================================
-- 2. Finances
-- =============================================================================================
-- The transaction's own columns, one row per version.
create table private.finances_transactions (
    version_id public.local_uuid primary key,
    source private.amazon_source not null default 'FINANCES' check (source = 'FINANCES'),
    posted_at timestamptz not null check (isfinite(posted_at)),
    posted_date date not null check (isfinite(posted_date)),          -- worked out: marketplace-local date
    marketplace_id private.nonblank not null,
    marketplace_name public.marketplace_name not null,
    account_type private.nonblank not null,
    transaction_type private.nonblank not null,                       -- Amazon's
    transaction_status text not null check (
        transaction_status in ('DEFERRED', 'DEFERRED_RELEASED', 'RELEASED')
    ),
    deferred_transaction_id text check (length(btrim(deferred_transaction_id)) > 0),  -- on a release copy
    release_transaction_id text check (length(btrim(release_transaction_id)) > 0),    -- on an original
    is_activity boolean not null,                                     -- worked out (rules 3); today's activity_eligible
    -- Worked out: on a sale or refund record, the customer order it belongs to. A disposal fee
    -- on a customer return finds its SKUs through it.
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

-- How one amount finds its company. Worked out from the type and stored, so that a later change
-- to the list of types never changes an amount a payout already pinned.
create type private.finances_route as enum (
    'SKU',             -- the SKU's assignment
    'FNSKU',           -- the ledger, by FNSKU, then the SKUs' assignments      (liquidation item)
    'ASIN',            -- the ledger, by ASIN, then the SKUs' assignments       (returns fee)
    'PROMOTION',       -- the promotion's assignment                            (coupon and deal fees)
    'SHIPMENT',        -- the shipment's assignment                             (inbound fees)
    'CUSTOMER_ORDER',  -- the SKUs on the sale and refund records of that order (disposal on a customer return)
    'AD_INVOICE',      -- a total; the lines of that invoice carry the money
    'STORAGE',         -- a total; the storage rows of that marketplace and month carry the money
    'AGED_STORAGE',    -- a total; the aged storage rows of that marketplace and month carry the money
    'REMOVAL_ORDER',   -- a total; the rows of that removal order carry the money
    'SELBOX'           -- no company: a SelBox type
);
create type private.selbox_group as enum ('ACCOUNT_FEE', 'BALANCE_MOVEMENT', 'TAX_RECLASSIFICATION');
create type private.amount_part as enum ('BASE', 'TAX', 'PROMO');

-- One amount of a charge: the base, the tax or the promo of one type on one item.
create table private.finances_amounts (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.finances_transactions (version_id),
    amount_number integer not null check (amount_number > 0),         -- its number inside the version
    item_index integer not null check (item_index >= 0),              -- the item = the charge; 0 without items
    breakdown_path text[] not null check (array_position(breakdown_path, null) is null),
    breakdown_indexes integer[] not null check (array_position(breakdown_indexes, null) is null),
    amount_type private.nonblank not null,                            -- worked out: one of the list of types
    amount_part private.amount_part not null,                         -- worked out
    route private.finances_route not null,                            -- worked out
    selbox_group private.selbox_group,                                -- worked out
    amount private.exact_numeric not null,
    quantity private.exact_numeric,
    fee_base private.exact_numeric,                                   -- worked out: what SelBox's service fee applies to
    -- Identifiers as Amazon gives them.
    sku text check (length(btrim(sku)) > 0),                          -- a value accepted as a SKU (rules 6)
    fnsku text check (length(btrim(fnsku)) > 0),                      -- liquidation item: Amazon's SKU field holds it
    asin text check (length(btrim(asin)) > 0),
    -- Worked out: the keys of the lookup the route makes.
    reference_id text check (length(btrim(reference_id)) > 0),        -- invoice, promotion, shipment, removal order or customer order
    covered_month private.month_start,                                -- the month a storage or aged storage charge covers
    ledger_first_month private.month_start,                           -- the ledger months the amount names
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
    -- An ID route may lack its ID (Amazon gave none): the amount is then a difference.
    check (reference_id is null
        or route in ('PROMOTION', 'SHIPMENT', 'CUSTOMER_ORDER', 'AD_INVOICE', 'REMOVAL_ORDER')),
    check (route <> 'CUSTOMER_ORDER' or reference_id is not null),
    check ((route = 'SELBOX') = (selbox_group is not null)),
    check (fee_base is null or route = 'SKU')
);
create index finances_amounts_reference_idx on private.finances_amounts (reference_id, route)
where reference_id is not null;
create index finances_amounts_sku_idx on private.finances_amounts (sku) where sku is not null;
create index finances_amounts_covered_month_idx on private.finances_amounts (covered_month, route)
where covered_month is not null;

-- =============================================================================================
-- 3. Ad invoices
-- =============================================================================================
-- The invoice's own columns, one row per version.
create table private.ad_invoices (
    version_id public.local_uuid primary key,
    source private.amazon_source not null default 'AD_INVOICE' check (source = 'AD_INVOICE'),
    invoice_id private.nonblank not null,
    invoice_status private.nonblank not null,
    invoice_date date not null,
    from_date date not null,
    to_date date not null check (to_date >= from_date),
    currency text not null references private.currencies (code),
    amount_due private.exact_numeric not null,                        -- as the invoice states it
    tax_amount_due private.exact_numeric not null,                    -- as the invoice states it
    tax_name text,                                                    -- "VAT"
    tax_country text,                                                 -- the taxed country, as stated
    tax_rate_stated private.exact_numeric not null,                   -- as stated: 0, 10 or 1000
    tax_rate_percent numeric not null check (tax_rate_percent >= 0 and tax_rate_percent <= 100),  -- worked out
    line_count integer not null check (line_count >= 0),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);
create index ad_invoices_invoice_idx on private.ad_invoices (invoice_id);

-- One campaign's cost on an invoice, or one adjustment.
create table private.ad_invoice_lines (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null references private.ad_invoices (version_id),
    line_number integer not null check (line_number > 0),             -- lines in Amazon's order, then adjustments
    -- Worked out:
    --   CAMPAIGN             a campaign's cost
    --   CAMPAIGN_ADJUSTMENT  the adjustment that names a campaign; it goes with that campaign
    --   ACCOUNT_ADJUSTMENT   the two adjustments that name none; a SelBox type, account fee
    line_kind text not null check (line_kind in ('CAMPAIGN', 'CAMPAIGN_ADJUSTMENT', 'ACCOUNT_ADJUSTMENT')),
    adjustment_kind text check (adjustment_kind in (
        'OVER_DELIVERY_AGAINST_CAMPAIGN', 'OVER_DELIVERY_CLICK_CREDITS', 'ROUNDING'
    )),
    -- Amazon's campaignId: the key of the campaign. On a CAMPAIGN_ADJUSTMENT it is worked out
    -- from the one line of the same invoice that carries the adjustment's campaign name.
    campaign_id text check (length(btrim(campaign_id)) > 0),
    campaign_aid text check (length(btrim(campaign_aid)) > 0),        -- Amazon's second ID; a TV campaign is asked by it
    campaign_name text,                                               -- a label only
    ad_program text check (ad_program in (
        'SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY', 'SPONSORED_TV'
    )),
    description text,                                                 -- the adjustment text, as Amazon gives it
    cost_amount private.exact_numeric not null,                       -- line cost or adjustment amount, before tax
    base_amount private.exact_numeric not null,                       -- worked out
    tax_amount private.exact_numeric not null,                        -- worked out: the invoice's rate of the base, not rounded
    created_at timestamptz not null default now(),
    unique (version_id, line_number),
    check ((line_kind = 'ACCOUNT_ADJUSTMENT') = (campaign_id is null)),
    check ((line_kind = 'CAMPAIGN') = (adjustment_kind is null)),
    check ((line_kind = 'CAMPAIGN') = (ad_program is not null)),
    check ((line_kind = 'CAMPAIGN_ADJUSTMENT')
        = (adjustment_kind is not distinct from 'OVER_DELIVERY_AGAINST_CAMPAIGN'))
);
create index ad_invoice_lines_campaign_idx on private.ad_invoice_lines (campaign_id)
where campaign_id is not null;

-- =============================================================================================
-- 4. The three reports
-- =============================================================================================
-- Each stores the columns that a rule or a screen reads. The other columns of Amazon's report
-- stay in the kept answer. row_number: the unit's rows sorted by their own stored columns, then
-- numbered from 1, so two rows that are equal in every column both count.

-- An FNSKU's fee in a warehouse for a month. The unit is the seller account and month of charge.
create table private.storage_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'STORAGE' check (source = 'STORAGE'),
    row_number integer not null check (row_number > 0),
    month_of_charge private.month_start not null,
    country_code private.nonblank not null,
    fulfillment_center text,
    fnsku private.nonblank not null,
    asin private.nonblank not null,                                   -- the report has no SKU column
    currency text not null references private.currencies (code),
    fee_amount private.exact_numeric not null,                        -- Amazon's fee, with its decimals
    marketplace_name public.marketplace_name not null,                -- worked out from the country
    base_amount private.exact_numeric not null,                       -- worked out by the tax table (rules 9)
    tax_amount private.exact_numeric not null,
    ledger_first_month private.month_start not null,                  -- worked out: both the month of charge
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);

-- An FNSKU's fee at a snapshot. The unit is the seller account and snapshot month.
create table private.aged_storage_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'AGED_STORAGE' check (source = 'AGED_STORAGE'),
    row_number integer not null check (row_number > 0),
    snapshot_at timestamptz not null check (isfinite(snapshot_at)),   -- read from Amazon's printed date
    snapshot_month private.month_start not null,                      -- worked out, in UTC
    country_code private.nonblank not null,
    fnsku private.nonblank not null,
    asin private.nonblank not null,
    sku_printed text,                                                 -- information only; no rule reads it
    condition text,
    age_tier text,                                                    -- rows of one FNSKU differ in it
    quantity_charged private.exact_numeric,
    currency text not null references private.currencies (code),
    fee_amount private.exact_numeric not null,
    marketplace_name public.marketplace_name not null,                -- worked out from the country
    base_amount private.exact_numeric not null,                       -- worked out by the tax table
    tax_amount private.exact_numeric not null,
    ledger_first_month private.month_start not null,                  -- worked out: both the snapshot month
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source)
);

-- A product of a removal order. The unit is the seller account and removal order.
-- Neither a marketplace nor a date for the calculation is stored here: both come from the
-- earliest Finances charge of the order.
create table private.removal_order_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'REMOVAL_ORDER' check (source = 'REMOVAL_ORDER'),
    row_number integer not null check (row_number > 0),
    removal_order_id private.nonblank not null,
    requested_at timestamptz not null check (isfinite(requested_at)),         -- instants; Amazon's printed
    last_updated_at timestamptz not null check (isfinite(last_updated_at)),   -- offset changes between downloads
    order_type text not null check (order_type in ('Disposal', 'Return', 'Liquidations')),
    order_status private.nonblank not null,
    fnsku private.nonblank not null,
    sku_printed text,                                                 -- information only
    disposition text,
    requested_quantity private.exact_numeric,
    cancelled_quantity private.exact_numeric,
    disposed_quantity private.exact_numeric,
    shipped_quantity private.exact_numeric,
    in_process_quantity private.exact_numeric,
    currency text references private.currencies (code),               -- Amazon leaves it empty on a row without a fee
    fee_amount private.exact_numeric,
    base_amount private.exact_numeric,                                -- worked out by seller account and currency
    tax_amount private.exact_numeric,
    ledger_first_month private.month_start not null,                  -- worked out: request month ...
    ledger_last_month private.month_start not null check (ledger_last_month >= ledger_first_month),  -- ... through last-updated month, in UTC
    created_at timestamptz not null default now(),
    unique (version_id, row_number),
    foreign key (version_id, source) references private.source_unit_versions (id, source),
    check (last_updated_at >= requested_at),
    check (coalesce(fee_amount, 0) = 0 or (currency is not null and base_amount is not null and tax_amount is not null))
);
create index removal_order_rows_order_idx on private.removal_order_rows (removal_order_id);

-- =============================================================================================
-- 5. Inventory ledger
-- =============================================================================================
-- Amazon's monthly row: one FNSKU of one SKU in one month, per condition and country.
-- The only place that turns an FNSKU or an ASIN into a SKU (rules 8). Not stored: the
-- quantities and the product title, which no rule reads.
create table private.inventory_ledger_rows (
    id public.local_uuid primary key default private.uuid7(),
    version_id public.local_uuid not null,
    source private.amazon_source not null default 'INVENTORY_LEDGER' check (source = 'INVENTORY_LEDGER'),
    row_number integer not null check (row_number > 0),
    seller_namespace private.nonblank not null,                       -- repeated from the unit, for the two searches
    amazon_scope private.nonblank not null,
    month private.month_start not null,                               -- Amazon's own column
    fnsku private.nonblank not null,
    sku private.nonblank not null,                                    -- Amazon's MSKU
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

-- =============================================================================================
-- 6. Information tables: the latest answer only
-- =============================================================================================
-- No amount is calculated from them. The cron job and the warning read their product lists.
-- batch_id is the preprocessing batch that stored the row. An ID that Amazon does not know gives
-- no row here; its acquisition is stored with the result UNKNOWN_ID.
create table private.campaigns (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    campaign_id private.nonblank not null,                            -- Amazon's campaignId, as on the invoice line
    campaign_aid text,
    ad_program text check (ad_program in (
        'SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY', 'SPONSORED_TV'
    )),
    campaign_name text,                                               -- a label only; campaigns are renamed
    campaign_state text,
    marketplace_name public.marketplace_name,
    start_date date,
    end_date date,
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, campaign_id)
);
create index campaigns_batch_idx on private.campaigns (batch_id);
-- A product as Amazon lists it: SKU and ASIN (Sponsored Products), SKU only (Display),
-- ASIN only (Sponsored Brands). A TV campaign has none.
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
    promotion_id private.nonblank not null,                           -- as on the Finances charge
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
create index promotions_batch_idx on private.promotions (batch_id);
create table private.promotion_products (
    promotion_row_id public.local_uuid not null references private.promotions (id) on delete cascade,
    product_number integer not null check (product_number > 0),
    sku text check (length(btrim(sku)) > 0),                          -- absent on a coupon
    asin text check (length(btrim(asin)) > 0),
    primary key (promotion_row_id, product_number),
    check (sku is not null or asin is not null)
);

create table private.shipments (
    id public.local_uuid primary key default private.uuid7(),
    seller_namespace private.nonblank not null,
    amazon_scope private.nonblank not null,
    shipment_id private.nonblank not null,                            -- as on the Finances charge
    shipment_name text,
    shipment_status text,
    destination_fulfillment_center text,
    batch_id public.local_uuid not null references private.source_preprocess_batches (id),
    created_at timestamptz not null default now(),
    unique (seller_namespace, amazon_scope, shipment_id)
);
create index shipments_batch_idx on private.shipments (batch_id);
create table private.shipment_items (
    shipment_row_id public.local_uuid not null references private.shipments (id) on delete cascade,
    product_number integer not null check (product_number > 0),
    sku private.nonblank not null,
    fnsku text check (length(btrim(fnsku)) > 0),
    quantity_shipped private.exact_numeric,
    quantity_received private.exact_numeric,
    primary key (shipment_row_id, product_number)
);

-- =============================================================================================
-- 7. Assignments
-- =============================================================================================
-- What can be assigned. A SKU is assigned by its exact text and holds in every seller account;
-- a campaign, promotion or shipment by Amazon's ID within one seller account.
-- A key is created when it is first assigned. No key points at an information table: an ID
-- without information can be assigned too.
create type public.assignment_kind as enum ('SKU', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT');
create table public.assignment_keys (
    id public.local_uuid primary key default private.uuid7(),
    kind public.assignment_kind not null,
    seller_namespace text check (length(btrim(seller_namespace)) > 0),
    amazon_scope text check (length(btrim(amazon_scope)) > 0),
    native_id text not null check (length(btrim(native_id)) > 0),     -- the SKU text, or Amazon's ID
    current_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique nulls not distinct (kind, seller_namespace, amazon_scope, native_id),
    unique (id, kind),
    check ((kind = 'SKU') = (seller_namespace is null)),
    check ((seller_namespace is null) = (amazon_scope is null))
);

-- Every change, with a memo. Blank = no key, no current version, or a current version without a
-- company. A blank is always a difference (rules 11).
create table public.assignment_versions (
    id public.local_uuid primary key default private.uuid7(),
    key_id public.local_uuid not null,
    kind public.assignment_kind not null,
    version_number bigint not null check (version_number > 0),
    company_id public.local_uuid references public.companies (id),   -- empty: an administrator cleared it
    origin text not null check (origin in ('ADMINISTRATOR', 'AUTOMATIC')),
    set_by uuid references auth.users (id),                           -- the administrator; empty when automatic
    memo text not null check (length(btrim(memo)) > 0),               -- an automatic version says so here
    fee_period_count integer not null check (fee_period_count >= 0),
    created_at timestamptz not null default now(),
    foreign key (key_id, kind) references public.assignment_keys (id, kind),
    unique (key_id, version_number),
    unique (key_id, id),
    unique (id, kind),
    -- The cron job writes only the first version of a key, and it always names a company. So it
    -- never changes an assignment that an administrator set or cleared.
    check (origin <> 'AUTOMATIC' or (version_number = 1 and company_id is not null and set_by is null)),
    check (kind <> 'SKU' or origin = 'ADMINISTRATOR'),               -- a SKU has no default
    check (kind = 'SKU' or fee_period_count = 0)                     -- fee rates exist only on SKUs
);
create index assignment_versions_company_idx on public.assignment_versions (company_id);
create index assignment_versions_set_by_idx on public.assignment_versions (set_by);
alter table public.assignment_keys add constraint assignment_keys_current_version
foreign key (id, current_version_id) references public.assignment_versions (key_id, id);

-- SelBox's fee rate of a SKU, per marketplace and period, as today.
create table public.sku_fee_periods (
    id public.local_uuid primary key default private.uuid7(),
    assignment_version_id public.local_uuid not null,
    kind public.assignment_kind not null default 'SKU' check (kind = 'SKU'),
    marketplace_name public.marketplace_name not null,
    valid_period daterange not null check (
        not isempty(valid_period) and not lower_inf(valid_period)
        and lower(valid_period) not in ('-infinity'::date, 'infinity'::date)
        and (upper_inf(valid_period) or upper(valid_period) not in ('-infinity'::date, 'infinity'::date))
        and lower_inc(valid_period) and not upper_inc(valid_period)
    ),
    fee_rate_percent numeric not null check (
        fee_rate_percent >= 0 and fee_rate_percent <= 100
        and fee_rate_percent::text not in ('NaN', 'Infinity', '-Infinity')
        and scale(fee_rate_percent) <= 6
    ),
    created_at timestamptz not null default now(),
    foreign key (assignment_version_id, kind) references public.assignment_versions (id, kind),
    unique (assignment_version_id, id),
    exclude using gist (assignment_version_id with =, marketplace_name with =, valid_period with &&)
);

-- =============================================================================================
-- 8. Payout reports
-- =============================================================================================
-- One company, one full month, one marketplace, one currency, with frozen totals, as today.
-- Gone: dataset_key. The three version counts become two.
create domain private.calculated_amount as numeric
check (value::text not in ('NaN', 'Infinity', '-Infinity'));

create table public.company_payout_reports (
    id public.local_uuid primary key default private.uuid7(),
    company_id public.local_uuid not null references public.companies (id),
    marketplace_name public.marketplace_name,           -- empty: a company-month without any amount
    currency text references private.currencies (code),
    start_date date not null check (isfinite(start_date)),
    end_date date not null check (isfinite(end_date) and end_date >= start_date),
    change_reason private.nonblank not null,
    record_count integer not null check (record_count >= 0),
    source_version_count integer not null check (source_version_count >= 0),
    assignment_version_count integer not null check (assignment_version_count >= 0),
    source_coverage jsonb not null default '[]'::jsonb check (jsonb_typeof(source_coverage) = 'array'),
    source_amount private.calculated_amount not null,   -- the company amounts
    fee_amount private.calculated_amount not null,      -- SelBox's service fee
    company_amount private.calculated_amount not null,
    created_at timestamptz not null default clock_timestamp(),
    check (extract(day from start_date) = 1 and end_date = (start_date + interval '1 month - 1 day')::date),
    check (company_amount = source_amount + fee_amount),
    check (currency is not null or (
        record_count = 0 and source_amount = 0 and fee_amount = 0 and company_amount = 0
    ))
);
create index company_payout_reports_scope_idx on public.company_payout_reports (
    company_id, start_date, marketplace_name, currency, created_at desc, id desc
);

-- The pins: every version the report's calculation read (schema.md 6).
create table private.payout_report_source_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    unit_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, unit_id),
    unique (report_id, version_id),
    foreign key (unit_id, version_id) references private.source_unit_versions (unit_id, id)
);
create index payout_source_version_idx on private.payout_report_source_versions (version_id);

create table private.payout_report_assignment_versions (
    report_id public.local_uuid not null references public.company_payout_reports (id),
    key_id public.local_uuid not null,
    version_id public.local_uuid not null,
    primary key (report_id, key_id),
    unique (report_id, version_id),
    foreign key (key_id, version_id) references public.assignment_versions (key_id, id)
);
create index payout_assignment_version_idx on private.payout_report_assignment_versions (version_id);
