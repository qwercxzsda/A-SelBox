-- Clean pre-deployment baseline for the three A-SelBox workflows.
-- Settlement sources and successful processing runs are append-only ground truth.
-- Elaboration inputs remain outside Postgres. Data Kiosk provisions are rolling.

create schema if not exists private;

create extension if not exists btree_gist with schema extensions;

create function private.is_unique_nonblank_text_array(candidate text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select coalesce(
        pg_catalog.array_ndims(candidate) = 1
        and pg_catalog.cardinality(candidate) > 0
        and not exists (
            select 1
            from pg_catalog.unnest(candidate) as item (value)
            where item.value is null
               or item.value = ''
               or item.value <> pg_catalog.btrim(item.value)
        )
        and pg_catalog.cardinality(candidate) = (
            select count(distinct item.value)
            from pg_catalog.unnest(candidate) as item (value)
        ),
        false
    );
$$;

create function private.is_exact_text_array(candidate text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select coalesce(
        pg_catalog.array_ndims(candidate) = 1
        and pg_catalog.cardinality(candidate) > 0
        and pg_catalog.array_position(candidate, null) is null,
        false
    );
$$;

create function private.is_nonblank_text_array(candidate text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select coalesce(
        pg_catalog.array_ndims(candidate) = 1
        and pg_catalog.cardinality(candidate) > 0
        and not exists (
            select 1
            from pg_catalog.unnest(candidate) as item (value)
            where item.value is null
               or item.value = ''
               or item.value <> pg_catalog.btrim(item.value)
        ),
        false
    );
$$;

create function private.is_unique_nonempty_text_array(candidate text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select coalesce(
        private.is_exact_text_array(candidate)
        and not ('' = any(candidate))
        and pg_catalog.cardinality(candidate) = (
            select count(distinct item.value)
            from pg_catalog.unnest(candidate) as item (value)
        ),
        false
    );
$$;

create function private.is_finite_numeric(candidate numeric)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select candidate is null or candidate not in (
        'NaN'::numeric,
        'Infinity'::numeric,
        '-Infinity'::numeric
    );
$$;

-- Fee rates are the only values with a database precision bound.
-- Check the value without coercing or rounding it into a numeric(p, s) column.
create function private.is_valid_fee_rate(candidate numeric)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
    select candidate is null or (
        private.is_finite_numeric(candidate)
        and candidate >= 0
        and candidate <= 100
        and pg_catalog.scale(candidate) <= 6
    );
$$;

create function private.is_current_transaction_xid(candidate xid)
returns boolean
language sql
stable
parallel restricted
set search_path = ''
as $$
    select exists (
        select 1
        from pg_catalog.pg_locks as transaction_lock
        where transaction_lock.locktype = 'transactionid'
          and transaction_lock.transactionid = candidate
          and transaction_lock.pid = pg_catalog.pg_backend_pid()
          and transaction_lock.mode = 'ExclusiveLock'
          and transaction_lock.granted
    );
$$;

create table public.companies (
    id uuid primary key default gen_random_uuid(),
    company_name text not null unique,
    created_at timestamptz default current_timestamp not null,

    constraint ck_companies_name
    check (
        company_name = pg_catalog.btrim(company_name)
        and company_name <> ''
    )
);

create table public.company_sku_fee_rates (
    id uuid primary key default gen_random_uuid(),
    seller_namespace text not null,
    marketplace_id text not null,
    sku text not null,
    company_id uuid not null references public.companies (id),
    fee_rate_percent numeric not null,
    valid_period daterange not null,
    created_at timestamptz default current_timestamp not null,

    constraint uq_company_sku_fee_rates_reference
    unique (
        id,
        seller_namespace,
        marketplace_id,
        sku,
        company_id,
        fee_rate_percent
    ),

    constraint uq_company_sku_fee_rates_result_reference
    unique (
        id,
        marketplace_id,
        sku,
        company_id,
        fee_rate_percent
    ),

    constraint ck_company_sku_fee_rates_identity
    check (
        seller_namespace = pg_catalog.btrim(seller_namespace)
        and seller_namespace <> ''
        and marketplace_id = pg_catalog.btrim(marketplace_id)
        and marketplace_id <> ''
        and sku = pg_catalog.btrim(sku)
        and sku <> ''
    ),

    constraint ck_company_sku_fee_rates_rate
    check (private.is_valid_fee_rate(fee_rate_percent)),

    constraint ck_company_sku_fee_rates_period
    check (
        not pg_catalog.isempty(valid_period)
        and pg_catalog.lower(valid_period) is not null
        and pg_catalog.lower_inc(valid_period)
        and not pg_catalog.upper_inc(valid_period)
    ),

    constraint ex_company_sku_fee_rates_no_overlap
    exclude using gist (
        seller_namespace with =,
        marketplace_id with =,
        sku with =,
        valid_period with &&
    )
);

create index idx_company_sku_fee_rates_company
on public.company_sku_fee_rates (company_id, marketplace_id, sku);

create table private.settlement_reports (
    id uuid primary key default gen_random_uuid(),
    seller_namespace text not null,
    amazon_scope text not null,
    amazon_report_id text not null,
    amazon_document_id text not null,
    amazon_report_created_at timestamptz not null,
    amazon_report_data_start_at timestamptz,
    amazon_report_data_end_at timestamptz,
    marketplace_ids text[] not null,
    marketplace_names text[] not null,
    tsv_columns text[] not null,
    column_count integer generated always as (
        pg_catalog.cardinality(tsv_columns)
    ) stored,
    metadata_values text[] not null,
    metadata_source_line_number integer not null,
    decoded_content_sha256 text not null,
    content_row_count bigint not null,
    inserted_at timestamptz default current_timestamp not null,

    constraint uq_settlement_reports_amazon_report
    unique (seller_namespace, amazon_scope, amazon_report_id),

    constraint uq_settlement_reports_amazon_document
    unique (seller_namespace, amazon_scope, amazon_document_id),

    constraint ck_settlement_reports_identity
    check (
        seller_namespace = pg_catalog.btrim(seller_namespace)
        and seller_namespace <> ''
        and amazon_report_id = pg_catalog.btrim(amazon_report_id)
        and amazon_report_id <> ''
        and amazon_document_id = pg_catalog.btrim(amazon_document_id)
        and amazon_document_id <> ''
    ),

    constraint ck_settlement_reports_scope
    check (
        amazon_scope in ('NA', 'EU', 'JAPAN', 'SINGAPORE', 'AUSTRALIA')
    ),

    constraint ck_settlement_reports_api_period
    check (
        amazon_report_data_start_at is null
        or amazon_report_data_end_at is null
        or amazon_report_data_start_at <= amazon_report_data_end_at
    ),

    constraint ck_settlement_reports_marketplaces
    check (
        private.is_unique_nonblank_text_array(marketplace_ids)
        and private.is_nonblank_text_array(marketplace_names)
        and pg_catalog.cardinality(marketplace_ids)
        = pg_catalog.cardinality(marketplace_names)
    ),

    constraint ck_settlement_reports_columns
    check (private.is_unique_nonempty_text_array(tsv_columns)),

    constraint ck_settlement_reports_metadata_width
    check (
        private.is_exact_text_array(metadata_values)
        and pg_catalog.cardinality(metadata_values) = column_count
    ),

    constraint ck_settlement_reports_metadata_line
    check (metadata_source_line_number > 0),

    constraint ck_settlement_reports_sha256
    check (decoded_content_sha256 ~ '^[0-9a-f]{64}$'),

    constraint ck_settlement_reports_content_count
    check (content_row_count >= 0)
);

create index idx_settlement_reports_oldest
on private.settlement_reports (
    seller_namespace,
    amazon_report_created_at,
    id
);

create table private.settlement_report_rows (
    id uuid primary key default gen_random_uuid(),
    settlement_report_id uuid not null
    references private.settlement_reports (id),
    source_line_number bigint not null,
    column_values text[] not null,
    inserted_at timestamptz default current_timestamp not null,

    constraint uq_settlement_report_rows_report_line
    unique (settlement_report_id, source_line_number),

    constraint uq_settlement_report_rows_source_reference
    unique (id, settlement_report_id, source_line_number),

    constraint ck_settlement_report_rows_line
    check (source_line_number > 0),

    constraint ck_settlement_report_rows_width
    check (private.is_exact_text_array(column_values))
);

create function private.enforce_settlement_report_row_width()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    expected_column_count integer;
    report_xid xid;
begin
    select
        settlement_report.column_count,
        settlement_report.xmin
    into
        expected_column_count,
        report_xid
    from private.settlement_reports as settlement_report
    where settlement_report.id = new.settlement_report_id;

    if not found then
        raise exception 'Settlement row references an unknown report.';
    end if;

    if not private.is_current_transaction_xid(report_xid) then
        raise exception 'Settlement rows must be inserted with their report.';
    end if;

    if pg_catalog.cardinality(new.column_values) <> expected_column_count then
        raise exception 'Settlement row width does not match its report columns.';
    end if;

    return new;
end;
$$;

create trigger enforce_settlement_report_row_width
before insert
on private.settlement_report_rows
for each row
execute function private.enforce_settlement_report_row_width();

create function private.enforce_settlement_report_content_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    declared_count bigint;
    stored_count bigint;
begin
    select settlement_report.content_row_count
    into declared_count
    from private.settlement_reports as settlement_report
    where settlement_report.id = new.id;

    if not found then
        raise exception 'Settlement content references an unknown report.';
    end if;

    select count(*)
    into stored_count
    from private.settlement_report_rows as report_row
    where report_row.settlement_report_id = new.id;

    if stored_count <> declared_count then
        raise exception
            'Settlement report % has % content rows but declares %.',
            new.id,
            stored_count,
            declared_count;
    end if;

    return new;
end;
$$;

create constraint trigger enforce_settlement_report_header_content_count
after insert
on private.settlement_reports
deferrable initially deferred
for each row
execute function private.enforce_settlement_report_content_count();

create table private.settlement_processing_logs (
    id uuid primary key default gen_random_uuid(),
    settlement_report_id uuid not null
    references private.settlement_reports (id),
    processor_version text not null,
    processed_at timestamptz default current_timestamp not null,

    constraint uq_settlement_processing_logs_report_reference
    unique (id, settlement_report_id),

    constraint ck_settlement_processing_logs_version
    check (
        processor_version = pg_catalog.btrim(processor_version)
        and processor_version <> ''
    )
);

create index idx_settlement_processing_logs_latest
on private.settlement_processing_logs (
    settlement_report_id,
    processed_at desc,
    id desc
);

create table private.settlement_processed_reports (
    processing_log_id uuid primary key,
    settlement_report_id uuid not null,
    settlement_id text not null,
    settlement_start_at timestamptz not null,
    settlement_end_at timestamptz not null,
    deposit_at timestamptz not null,
    total_amount numeric not null,
    currency text not null,
    settlement_start_date date not null,
    settlement_end_date date not null,
    processed_entry_count bigint not null,
    processed_result_count bigint not null,
    created_at timestamptz default current_timestamp not null,

    constraint fk_settlement_processed_reports_log
    foreign key (processing_log_id, settlement_report_id)
    references private.settlement_processing_logs (id, settlement_report_id),

    constraint ck_settlement_processed_reports_identity
    check (
        settlement_id = pg_catalog.btrim(settlement_id)
        and settlement_id <> ''
    ),

    constraint ck_settlement_processed_reports_timestamp_period
    check (settlement_start_at <= settlement_end_at),

    constraint ck_settlement_processed_reports_date_period
    check (settlement_start_date <= settlement_end_date),

    constraint ck_settlement_processed_reports_currency
    check (currency ~ '^[A-Z]{3}$'),

    constraint ck_settlement_processed_reports_total
    check (private.is_finite_numeric(total_amount)),

    constraint ck_settlement_processed_reports_counts
    check (
        processed_entry_count >= 0
        and processed_result_count >= 0
    )
);

create table private.settlement_processed_entries (
    id uuid primary key default gen_random_uuid(),
    processing_log_id uuid not null,
    settlement_report_id uuid not null,
    settlement_report_row_id uuid not null,
    source_line_number bigint not null,
    posted_date date not null,
    posted_at timestamptz not null,
    currency text not null,
    settlement_amount numeric not null,
    transaction_type text not null,
    amount_type text not null,
    amount_description text not null,
    category_code text not null,
    pnl_treatment text not null,
    handling_method text not null,
    amazon_order_id text,
    merchant_order_id text,
    amazon_order_item_id text,
    merchant_order_item_id text,
    amazon_adjustment_id text,
    merchant_adjustment_item_id text,
    amazon_shipment_id text,
    fulfillment_id text,
    marketplace_name text,
    marketplace_id text,
    sku text,
    quantity bigint,
    promotion_id text,
    created_at timestamptz default current_timestamp not null,

    constraint uq_settlement_processed_entries_run_source
    unique (processing_log_id, source_line_number),

    constraint fk_settlement_processed_entries_log
    foreign key (processing_log_id, settlement_report_id)
    references private.settlement_processing_logs (id, settlement_report_id),

    constraint fk_settlement_processed_entries_source
    foreign key (
        settlement_report_row_id,
        settlement_report_id,
        source_line_number
    )
    references private.settlement_report_rows (
        id,
        settlement_report_id,
        source_line_number
    ),

    constraint ck_settlement_processed_entries_currency
    check (currency ~ '^[A-Z]{3}$'),

    constraint ck_settlement_processed_entries_amount
    check (private.is_finite_numeric(settlement_amount)),

    constraint ck_settlement_processed_entries_taxonomy
    check (
        transaction_type <> ''
        and amount_type <> ''
        and amount_description <> ''
        and category_code <> ''
        and pnl_treatment <> ''
        and handling_method <> ''
    ),

    constraint ck_settlement_processed_entries_quantity
    check (quantity is null or quantity >= 0)
);

create function private.enforce_settlement_processing_inventory()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    declared_entry_count bigint;
    declared_result_count bigint;
    stored_entry_count bigint;
    stored_result_count bigint;
begin
    select
        processed_report.processed_entry_count,
        processed_report.processed_result_count
    into
        declared_entry_count,
        declared_result_count
    from private.settlement_processed_reports as processed_report
    where processed_report.processing_log_id = new.id;

    if not found then
        raise exception 'Settlement processing log has no processed report.';
    end if;

    select count(*)
    into stored_entry_count
    from private.settlement_processed_entries as processed_entry
    where processed_entry.processing_log_id = new.id;

    select count(*)
    into stored_result_count
    from private.settlement_processed_results as processed_result
    where processed_result.processing_log_id = new.id;

    if stored_entry_count <> declared_entry_count
       or stored_result_count <> declared_result_count
    then
        raise exception
            'Settlement processing log % has incomplete output inventory.',
            new.id;
    end if;

    return new;
end;
$$;

create index idx_settlement_processed_entries_source
on private.settlement_processed_entries (
    settlement_report_row_id,
    settlement_report_id
);

create table private.settlement_processed_results (
    id uuid primary key default gen_random_uuid(),
    processing_log_id uuid not null,
    settlement_report_id uuid not null,
    company_sku_fee_rate_id uuid,
    company_id uuid,
    marketplace_id text,
    sku text,
    category_code text not null,
    pnl_treatment text not null,
    allocation_method text not null,
    unassigned_reason text,
    activity_start_date date not null,
    activity_end_date date not null,
    currency text not null,
    settlement_amount numeric not null,
    elaborated_amount numeric default 0 not null,
    difference_amount numeric generated always as (
        settlement_amount - elaborated_amount
    ) stored,
    selbox_fee_base numeric default 0 not null,
    applied_fee_rate_percent numeric,
    selbox_fee numeric default 0 not null,
    company_payable numeric generated always as (
        settlement_amount + selbox_fee
    ) stored,
    settlement_quantity numeric,
    elaborated_quantity numeric,
    difference_quantity numeric,
    selbox_fee_base_quantity numeric,
    selbox_fee_quantity numeric,
    company_payable_quantity numeric,
    created_at timestamptz default current_timestamp not null,

    constraint fk_settlement_processed_results_log
    foreign key (processing_log_id, settlement_report_id)
    references private.settlement_processing_logs (id, settlement_report_id),

    constraint fk_settlement_processed_results_fee_rate
    foreign key (
        company_sku_fee_rate_id,
        marketplace_id,
        sku,
        company_id,
        applied_fee_rate_percent
    )
    references public.company_sku_fee_rates (
        id,
        marketplace_id,
        sku,
        company_id,
        fee_rate_percent
    ),

    constraint ck_settlement_processed_results_identity
    check (
        category_code = pg_catalog.btrim(category_code)
        and category_code <> ''
        and pnl_treatment = pg_catalog.btrim(pnl_treatment)
        and pnl_treatment <> ''
        and allocation_method = pg_catalog.btrim(allocation_method)
        and allocation_method <> ''
    ),

    constraint ck_settlement_processed_results_activity_period
    check (activity_start_date <= activity_end_date),

    constraint ck_settlement_processed_results_currency
    check (currency ~ '^[A-Z]{3}$'),

    constraint ck_settlement_processed_results_finite_amounts
    check (
        private.is_finite_numeric(settlement_amount)
        and private.is_finite_numeric(elaborated_amount)
        and private.is_finite_numeric(selbox_fee_base)
        and private.is_finite_numeric(applied_fee_rate_percent)
        and private.is_finite_numeric(selbox_fee)
    ),

    constraint ck_settlement_processed_results_quantities
    check (
        private.is_finite_numeric(settlement_quantity)
        and private.is_finite_numeric(elaborated_quantity)
        and private.is_finite_numeric(difference_quantity)
        and private.is_finite_numeric(selbox_fee_base_quantity)
        and private.is_finite_numeric(selbox_fee_quantity)
        and private.is_finite_numeric(company_payable_quantity)
    ),

    constraint ck_settlement_processed_results_fee_shape
    check (
        (
            company_sku_fee_rate_id is null
            and company_id is null
            and applied_fee_rate_percent is null
            and selbox_fee = 0
        )
        or (
            company_sku_fee_rate_id is not null
            and company_id is not null
            and marketplace_id is not null
            and sku is not null
            and applied_fee_rate_percent is not null
        )
    ),

    constraint ck_settlement_processed_results_fee_rate
    check (private.is_valid_fee_rate(applied_fee_rate_percent)),

    constraint ck_settlement_processed_results_fee_equation
    check (
        applied_fee_rate_percent is null
        or selbox_fee = -(
            selbox_fee_base * applied_fee_rate_percent * 0.01
        )
    )
);

create index idx_settlement_processed_results_run_company
on private.settlement_processed_results (
    processing_log_id,
    company_id,
    activity_start_date,
    sku
);

create index idx_settlement_processed_results_fee_rate
on private.settlement_processed_results (company_sku_fee_rate_id)
where company_sku_fee_rate_id is not null;

create table private.data_kiosk_provisions (
    seller_namespace text not null,
    amazon_scope text not null,
    marketplace_id text not null,
    activity_date date not null,
    sku text not null,
    currency text not null,
    company_id uuid,
    company_sku_fee_rate_id uuid,
    child_asin text,
    fnsku text,
    parent_asin text,
    units_sold numeric not null,
    units_returned numeric not null,
    net_units_sold numeric not null,
    average_sales_price numeric,
    product_sales numeric not null,
    product_refunds numeric not null,
    net_product_sales numeric not null,
    amazon_fee_total numeric not null,
    advertising_total numeric not null,
    cost_of_goods_sold_per_unit numeric,
    shipping_to_amazon_cost_per_unit numeric,
    mfn_fulfillment_cost_per_unit numeric,
    mfn_storage_cost_per_unit numeric,
    miscellaneous_cost_per_unit numeric,
    net_proceeds_per_unit numeric,
    net_proceeds_total numeric,
    fee_breakdown jsonb default '[]'::jsonb not null,
    ad_breakdown jsonb default '[]'::jsonb not null,
    selbox_fee_base numeric not null,
    applied_fee_rate_percent numeric,
    selbox_fee numeric default 0 not null,
    product_sales_quantity numeric generated always as (units_sold) stored,
    product_refunds_quantity numeric generated always as (units_returned) stored,
    net_product_sales_quantity numeric generated always as (net_units_sold) stored,
    selbox_fee_base_quantity numeric generated always as (units_sold) stored,
    selbox_fee_quantity numeric generated always as (units_sold) stored,
    amazon_fee_total_quantity numeric,
    advertising_total_quantity numeric,
    net_proceeds_total_quantity numeric,
    refreshed_at timestamptz not null,

    primary key (
        seller_namespace,
        amazon_scope,
        marketplace_id,
        activity_date,
        sku,
        currency
    ),

    constraint fk_data_kiosk_provisions_fee_rate
    foreign key (
        company_sku_fee_rate_id,
        seller_namespace,
        marketplace_id,
        sku,
        company_id,
        applied_fee_rate_percent
    )
    references public.company_sku_fee_rates (
        id,
        seller_namespace,
        marketplace_id,
        sku,
        company_id,
        fee_rate_percent
    ),

    constraint ck_data_kiosk_provisions_identity
    check (
        seller_namespace = pg_catalog.btrim(seller_namespace)
        and seller_namespace <> ''
        and marketplace_id = pg_catalog.btrim(marketplace_id)
        and marketplace_id <> ''
        and sku = pg_catalog.btrim(sku)
        and sku <> ''
    ),

    constraint ck_data_kiosk_provisions_scope
    check (
        amazon_scope in ('NA', 'EU', 'JAPAN', 'SINGAPORE', 'AUSTRALIA')
    ),

    constraint ck_data_kiosk_provisions_currency
    check (currency ~ '^[A-Z]{3}$'),

    constraint ck_data_kiosk_provisions_integral_units
    check (
        units_sold = pg_catalog.trunc(units_sold)
        and units_returned = pg_catalog.trunc(units_returned)
        and net_units_sold = pg_catalog.trunc(net_units_sold)
        and units_sold >= 0
        and units_returned >= 0
    ),

    constraint ck_data_kiosk_provisions_unit_equation
    check (net_units_sold = units_sold - units_returned),

    constraint ck_data_kiosk_provisions_sales_equation
    check (
        product_refunds >= 0
        and net_product_sales = product_sales - product_refunds
        and selbox_fee_base = product_sales
    ),

    constraint ck_data_kiosk_provisions_finite_values
    check (
        private.is_finite_numeric(units_sold)
        and private.is_finite_numeric(units_returned)
        and private.is_finite_numeric(net_units_sold)
        and private.is_finite_numeric(average_sales_price)
        and private.is_finite_numeric(product_sales)
        and private.is_finite_numeric(product_refunds)
        and private.is_finite_numeric(net_product_sales)
        and private.is_finite_numeric(amazon_fee_total)
        and private.is_finite_numeric(advertising_total)
        and private.is_finite_numeric(cost_of_goods_sold_per_unit)
        and private.is_finite_numeric(shipping_to_amazon_cost_per_unit)
        and private.is_finite_numeric(mfn_fulfillment_cost_per_unit)
        and private.is_finite_numeric(mfn_storage_cost_per_unit)
        and private.is_finite_numeric(miscellaneous_cost_per_unit)
        and private.is_finite_numeric(net_proceeds_per_unit)
        and private.is_finite_numeric(net_proceeds_total)
        and private.is_finite_numeric(selbox_fee_base)
        and private.is_finite_numeric(applied_fee_rate_percent)
        and private.is_finite_numeric(selbox_fee)
        and private.is_finite_numeric(amazon_fee_total_quantity)
        and private.is_finite_numeric(advertising_total_quantity)
        and private.is_finite_numeric(net_proceeds_total_quantity)
    ),

    constraint ck_data_kiosk_provisions_breakdowns
    check (
        pg_catalog.jsonb_typeof(fee_breakdown) = 'array'
        and pg_catalog.jsonb_typeof(ad_breakdown) = 'array'
    ),

    constraint ck_data_kiosk_provisions_fee_shape
    check (
        (
            company_sku_fee_rate_id is null
            and company_id is null
            and applied_fee_rate_percent is null
            and selbox_fee = 0
        )
        or (
            company_sku_fee_rate_id is not null
            and company_id is not null
            and applied_fee_rate_percent is not null
        )
    ),

    constraint ck_data_kiosk_provisions_fee_rate
    check (private.is_valid_fee_rate(applied_fee_rate_percent)),

    constraint ck_data_kiosk_provisions_fee_equation
    check (
        applied_fee_rate_percent is null
        or selbox_fee = -(
            selbox_fee_base * applied_fee_rate_percent * 0.01
        )
    )
);

create index idx_data_kiosk_provisions_company_date
on private.data_kiosk_provisions (
    company_id,
    activity_date,
    marketplace_id,
    sku
);

create index idx_data_kiosk_provisions_fee_rate
on private.data_kiosk_provisions (company_sku_fee_rate_id)
where company_sku_fee_rate_id is not null;

create function private.enforce_settlement_processed_result_fee_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    report_seller_namespace text;
    rate_seller_namespace text;
    rate_period daterange;
begin
    select settlement_report.seller_namespace
    into report_seller_namespace
    from private.settlement_processing_logs as processing_log
    inner join private.settlement_reports as settlement_report
        on settlement_report.id = processing_log.settlement_report_id
    where processing_log.id = new.processing_log_id
      and processing_log.settlement_report_id = new.settlement_report_id;

    if not found then
        raise exception 'Processed result log does not match its Settlement report.';
    end if;

    if new.company_sku_fee_rate_id is null then
        return new;
    end if;

    select
        fee_rate.seller_namespace,
        fee_rate.valid_period
    into
        rate_seller_namespace,
        rate_period
    from public.company_sku_fee_rates as fee_rate
    where fee_rate.id = new.company_sku_fee_rate_id;

    if not found
       or rate_seller_namespace <> report_seller_namespace
       or not new.activity_start_date <@ rate_period
       or not new.activity_end_date <@ rate_period
    then
        raise exception 'Processed result uses a fee rate outside its effective period.';
    end if;

    return new;
end;
$$;

create trigger enforce_settlement_processed_result_fee_period
before insert
on private.settlement_processed_results
for each row
execute function private.enforce_settlement_processed_result_fee_period();

create function private.enforce_data_kiosk_provision_fee_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    rate_period daterange;
begin
    if new.company_sku_fee_rate_id is null then
        return new;
    end if;

    select fee_rate.valid_period
    into rate_period
    from public.company_sku_fee_rates as fee_rate
    where fee_rate.id = new.company_sku_fee_rate_id;

    if not found or not new.activity_date <@ rate_period then
        raise exception 'Data Kiosk provision uses a fee rate outside its effective period.';
    end if;

    return new;
end;
$$;

create trigger enforce_data_kiosk_provision_fee_period
before insert or update
on private.data_kiosk_provisions
for each row
execute function private.enforce_data_kiosk_provision_fee_period();

create function private.enforce_processing_child_same_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    processing_log_xid xid;
begin
    select processing_log.xmin
    into processing_log_xid
    from private.settlement_processing_logs as processing_log
    where processing_log.id = new.processing_log_id;

    if not found
       or not private.is_current_transaction_xid(processing_log_xid)
    then
        raise exception 'Processed rows must be inserted with their processing log.';
    end if;

    return new;
end;
$$;

create trigger enforce_processed_report_same_transaction
before insert
on private.settlement_processed_reports
for each row
execute function private.enforce_processing_child_same_transaction();

create trigger enforce_processed_entry_same_transaction
before insert
on private.settlement_processed_entries
for each row
execute function private.enforce_processing_child_same_transaction();

create trigger enforce_processed_result_same_transaction
before insert
on private.settlement_processed_results
for each row
execute function private.enforce_processing_child_same_transaction();

create constraint trigger enforce_settlement_processing_log_inventory
after insert
on private.settlement_processing_logs
deferrable initially deferred
for each row
execute function private.enforce_settlement_processing_inventory();

create function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception '% is append-only.', tg_table_schema || '.' || tg_table_name;
end;
$$;

create trigger reject_company_sku_fee_rate_mutation
before update or delete
on public.company_sku_fee_rates
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_report_mutation
before update or delete
on private.settlement_reports
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_report_row_mutation
before update or delete
on private.settlement_report_rows
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processing_log_mutation
before update or delete
on private.settlement_processing_logs
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_report_mutation
before update or delete
on private.settlement_processed_reports
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_entry_mutation
before update or delete
on private.settlement_processed_entries
for each row
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_result_mutation
before update or delete
on private.settlement_processed_results
for each row
execute function private.reject_append_only_mutation();

create trigger reject_company_sku_fee_rate_truncate
before truncate
on public.company_sku_fee_rates
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_report_truncate
before truncate
on private.settlement_reports
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_report_row_truncate
before truncate
on private.settlement_report_rows
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processing_log_truncate
before truncate
on private.settlement_processing_logs
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_report_truncate
before truncate
on private.settlement_processed_reports
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_entry_truncate
before truncate
on private.settlement_processed_entries
for each statement
execute function private.reject_append_only_mutation();

create trigger reject_settlement_processed_result_truncate
before truncate
on private.settlement_processed_results
for each statement
execute function private.reject_append_only_mutation();

create view private.latest_settlement_processing_logs
with (security_invoker = true)
as
select distinct on (processing_log.settlement_report_id)
    processing_log.id,
    processing_log.settlement_report_id,
    processing_log.processor_version,
    processing_log.processed_at
from private.settlement_processing_logs as processing_log
order by
    processing_log.settlement_report_id asc,
    processing_log.processed_at desc,
    processing_log.id desc;

create view private.latest_settlement_processed_results
with (security_invoker = true)
as
select
    processed_result.id,
    processed_result.processing_log_id,
    processed_result.settlement_report_id,
    processed_result.company_sku_fee_rate_id,
    processed_result.company_id,
    processed_result.marketplace_id,
    processed_result.sku,
    processed_result.category_code,
    processed_result.pnl_treatment,
    processed_result.allocation_method,
    processed_result.unassigned_reason,
    processed_result.activity_start_date,
    processed_result.activity_end_date,
    processed_result.currency,
    processed_result.settlement_amount,
    processed_result.elaborated_amount,
    processed_result.difference_amount,
    processed_result.selbox_fee_base,
    processed_result.applied_fee_rate_percent,
    processed_result.selbox_fee,
    processed_result.company_payable,
    processed_result.settlement_quantity,
    processed_result.elaborated_quantity,
    processed_result.difference_quantity,
    processed_result.selbox_fee_base_quantity,
    processed_result.selbox_fee_quantity,
    processed_result.company_payable_quantity,
    processed_result.created_at
from private.settlement_processed_results as processed_result
inner join private.latest_settlement_processing_logs as latest_log
    on
        processed_result.processing_log_id = latest_log.id
        and processed_result.settlement_report_id
        = latest_log.settlement_report_id;

comment on table private.settlement_reports is
'Immutable Reports API identity and lossless structural Settlement TSV parse.';

comment on table private.settlement_report_rows is
'Immutable transaction rows preserving every decoded TSV cell as exact text.';

comment on table private.settlement_processing_logs is
'One immutable successful processing record per invocation; retries insert new rows.';

comment on table private.data_kiosk_provisions is
'Current rolling Data Kiosk estimates; one transaction deletes the old scope '
'and inserts the new scope.';

alter table public.companies enable row level security;
alter table public.company_sku_fee_rates enable row level security;
alter table private.settlement_reports enable row level security;
alter table private.settlement_report_rows enable row level security;
alter table private.settlement_processing_logs enable row level security;
alter table private.settlement_processed_reports enable row level security;
alter table private.settlement_processed_entries enable row level security;
alter table private.settlement_processed_results enable row level security;
alter table private.data_kiosk_provisions enable row level security;

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on all tables in schema public, private
from public, anon, authenticated, service_role;
revoke all on all sequences in schema public, private
from public, anon, authenticated, service_role;
revoke all on all functions in schema public, private
from public, anon, authenticated, service_role;

-- End clean workflow data model.
