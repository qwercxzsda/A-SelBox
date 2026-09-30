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
-- Ownership and fees follow exact SKU text across every source namespace.
create table public.skus (
    id public.local_uuid primary key default private.uuid7(),
    sku text not null check (length(btrim(sku)) > 0),
    current_terms_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique (sku)
);
create table public.sku_terms_versions (
    id public.local_uuid primary key default private.uuid7(),
    sku_id public.local_uuid not null references public.skus (id),
    company_id public.local_uuid references public.companies (id),
    version_number bigint not null check (version_number > 0),
    fee_period_count integer not null check (fee_period_count >= 0),
    change_reason text not null check (length(btrim(change_reason)) > 0),
    created_at timestamptz not null default now(),
    unique (sku_id, version_number), unique (sku_id, id)
);
create index sku_terms_versions_company_idx on public.sku_terms_versions (company_id);
alter table public.skus add constraint sku_current_terms_identity
foreign key (id, current_terms_version_id)
references public.sku_terms_versions (sku_id, id);
create table public.sku_fee_periods (
    id public.local_uuid primary key default private.uuid7(),
    terms_version_id public.local_uuid not null references public.sku_terms_versions (id),
    marketplace_name text not null check (marketplace_name in (
        'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
        'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
        'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
        'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
        'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
    )),
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
