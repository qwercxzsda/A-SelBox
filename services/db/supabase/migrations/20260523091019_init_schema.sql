create schema if not exists private;

create extension if not exists btree_gist with schema extensions;

create table private.settlements (
    id uuid primary key default gen_random_uuid(),
    amz_region varchar(20) not null,
    amz_settlement_id varchar(255) not null,
    amz_document_id varchar(255) not null,
    amz_settlement_start_date varchar(255) not null,
    amz_settlement_end_date varchar(255) not null,
    amz_deposit_date varchar(255) not null,
    amz_total_amount varchar(255) not null,
    amz_currency varchar(3) not null,
    created_at timestamptz default current_timestamp not null,

    constraint uq_settlements_region_settlement_id
    unique (amz_region, amz_settlement_id),

    constraint uq_settlements_region_document_id
    unique (amz_region, amz_document_id)
);

create table private.settlement_transactions (
    id uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references private.settlements (id),
    amz_report_line_no int not null,

    amz_transaction_type varchar(255) not null,
    amz_order_id varchar(255),
    amz_merchant_order_id varchar(255),
    amz_adjustment_id varchar(255),
    amz_shipment_id varchar(255),
    amz_marketplace_name varchar(255),
    amz_amount_type varchar(255) not null,
    amz_amount_description varchar(255) not null,
    amz_amount varchar(255) not null,
    amz_fulfillment_id varchar(255),
    amz_posted_date varchar(255) not null,
    amz_posted_date_time varchar(255) not null,
    amz_order_item_code varchar(255),
    amz_merchant_order_item_id varchar(255),
    amz_merchant_adjustment_item_id varchar(255),
    amz_sku varchar(255),
    amz_quantity_purchased varchar(255),
    amz_promotion_id varchar(255),
    created_at timestamptz default current_timestamp not null,

    constraint uq_settlement_tx_settlement_report_line_no
    unique (settlement_id, amz_report_line_no)
);

create table public.companies (
    id uuid primary key default gen_random_uuid(),
    company_name varchar(255) not null unique,
    created_at timestamptz default current_timestamp not null
);

create table public.company_fees (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies (id),
    amz_sku varchar(255) not null,
    amz_marketplace_name varchar(255) default '__ALL__' not null,
    fee_rate numeric(12, 10) not null,
    valid_period tstzrange not null,
    created_at timestamptz default current_timestamp not null,

    constraint ck_company_fees_fee_rate_valid
    check (fee_rate >= 0 and fee_rate <= 1),

    constraint ck_company_fees_valid_period_not_empty
    check (not isempty(valid_period)),

    constraint ck_company_fees_valid_period_lower_upper
    check (lower_inc(valid_period) and not upper_inc(valid_period)),

    constraint ex_company_fees_valid_period_no_overlap
    exclude using gist (
        amz_sku with =,
        amz_marketplace_name with =,
        valid_period with &&
    )
);

create table public.users_companies (
    user_id uuid primary key references auth.users (id) on delete cascade,
    company_id uuid not null references public.companies (id),
    created_at timestamptz default current_timestamp not null
);

create table private.admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz default current_timestamp not null
);

create table private.preprocess_runs (
    id uuid primary key default gen_random_uuid(),
    run_no bigint generated always as identity unique,
    preprocess_version varchar(255) not null,
    preprocess_type varchar(50) not null,
    preprocess_description text default '' not null,
    created_at timestamptz default current_timestamp not null,

    constraint preprocess_runs_preprocess_type_valid
    check (preprocess_type in ('order', 'storage', 'advertisement', 'disposal'))
);

create index preprocess_runs_preprocess_type_run_no_idx
on private.preprocess_runs (preprocess_type, run_no desc);

create table private.order_transactions (
    id uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references private.settlements (id),
    amz_posted_date_time timestamptz not null,

    amz_sku varchar(255) not null,
    amz_order_id varchar(255) not null,
    amz_marketplace_name varchar(255),

    amz_order_item_price numeric(38, 6),
    amz_order_item_fees numeric(38, 6),
    amz_order_item_withheld_tax numeric(38, 6),
    amz_order_promotion numeric(38, 6),
    amz_refund numeric(38, 6),
    amz_others numeric(38, 6),

    selbox_fees numeric(38, 6),
    net_amount numeric(38, 6) generated always as (
        coalesce(amz_order_item_price, 0)
        + coalesce(amz_order_item_fees, 0)
        + coalesce(amz_order_item_withheld_tax, 0)
        + coalesce(amz_order_promotion, 0)
        + coalesce(amz_refund, 0)
        + coalesce(amz_others, 0)
        + coalesce(selbox_fees, 0)
    ) stored,

    amz_quantity_purchased int4,
    amz_details jsonb default '{}'::jsonb not null,
    amz_currency varchar(3) not null,

    company_id uuid references public.companies (id),
    company_fee_id uuid references public.company_fees (id),

    preprocess_run_id uuid not null references private.preprocess_runs (id),
    created_at timestamptz default current_timestamp not null,

    is_current boolean not null default true,

    constraint uq_order_transactions_settlement_order_sku_run
    unique (settlement_id, amz_order_id, amz_sku, preprocess_run_id)
);

create unique index uq_order_transactions_only_one_current
on private.order_transactions (
    settlement_id,
    amz_order_id,
    amz_sku
)
where is_current;

create index idx_order_transactions_current_company_date_sku
on private.order_transactions (
    company_id,
    amz_posted_date_time desc,
    amz_sku
)
where is_current;

create table private.settlement_transactions_order_transactions (
    id uuid primary key default gen_random_uuid(),
    settlement_transaction_id uuid not null references private.settlement_transactions (id),
    order_transaction_id uuid not null references private.order_transactions (id),
    created_at timestamptz default current_timestamp not null,

    constraint uq_settlement_transaction_order_transaction_pair
    unique (settlement_transaction_id, order_transaction_id)
);

create index idx_settlement_tx_order_tx_id
on private.settlement_transactions_order_transactions (order_transaction_id);

create table private.no_sku_transactions (
    id uuid primary key default gen_random_uuid(),
    settlement_transaction_id uuid not null references private.settlement_transactions (id),
    amz_posted_date_time timestamptz not null,

    amz_sku varchar(255) default '__UNKNOWN__' not null,
    amz_order_id varchar(255),
    amz_marketplace_name varchar(255),

    amz_type varchar(255),
    amz_amount numeric(38, 6),
    description varchar(255),

    selbox_fees numeric(38, 6),
    amz_currency varchar(3) not null,

    company_id uuid references public.companies (id),
    company_fee_id uuid references public.company_fees (id),

    preprocess_run_id uuid not null references private.preprocess_runs (id),
    created_at timestamptz default current_timestamp not null,

    is_current boolean not null default true,

    constraint uq_no_sku_transactions_settlement_tx_sku_run
    unique (settlement_transaction_id, amz_sku, preprocess_run_id)
);

create unique index uq_no_sku_transactions_only_one_current
on private.no_sku_transactions (settlement_transaction_id, amz_sku)
where is_current;

create index idx_no_sku_transactions_current_company_date_sku
on private.no_sku_transactions (
    company_id,
    amz_posted_date_time desc,
    amz_sku
)
where is_current;

create table private.settlements_preprocess_runs (
    id uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references private.settlements (id),
    preprocess_run_id uuid not null references private.preprocess_runs (id),
    created_at timestamptz default current_timestamp not null,

    constraint uq_settlement_preprocess_run_pair
    unique (settlement_id, preprocess_run_id)
);

create or replace function private.get_company()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
    select uc.company_id
    from public.users_companies uc
    where uc.user_id = auth.uid()
    limit 1;
$$;

create or replace function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
    select exists (
        select 1
        from private.admins admins
        where admins.user_id = auth.uid()
    );
$$;

create view public.order_transactions_view
with (security_invoker = true)
as
select
    ot.id,
    ot.amz_posted_date_time,
    ot.amz_sku,
    ot.amz_order_id,
    ot.amz_marketplace_name,
    ot.amz_order_item_price,
    ot.amz_order_item_fees,
    ot.amz_order_item_withheld_tax,
    ot.amz_order_promotion,
    ot.amz_refund,
    ot.amz_others,
    ot.selbox_fees,
    ot.net_amount,
    ot.amz_quantity_purchased,
    ot.amz_details,
    ot.amz_currency,
    ot.created_at
from private.order_transactions as ot
where ot.is_current;

create view public.no_sku_transactions_view
with (security_invoker = true)
as
select
    nst.id,
    nst.amz_posted_date_time,
    nst.amz_sku,
    nst.amz_order_id,
    nst.amz_marketplace_name,
    nst.amz_type,
    nst.amz_amount,
    nst.description,
    nst.selbox_fees,
    nst.amz_currency,
    nst.created_at
from private.no_sku_transactions as nst
where nst.is_current;
