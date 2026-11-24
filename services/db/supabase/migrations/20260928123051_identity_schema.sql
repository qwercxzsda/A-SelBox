create table public.companies (
    id public.local_uuid primary key default private.uuid7(),
    name text not null check (length(btrim(name)) > 0), -- noqa: RF04
    created_at timestamptz not null default now()
);
create type public.app_access_role as enum ('administrator', 'member', 'unassigned');
create table public.app_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    access_role public.app_access_role not null default 'unassigned',
    company_id public.local_uuid references public.companies (id),
    created_at timestamptz not null default now(),
    check (
        (access_role in ('administrator', 'unassigned') and company_id is null)
        or (access_role = 'member' and company_id is not null)
    )
);
create index app_accounts_company_idx on public.app_accounts (company_id);

create type public.assignment_kind as enum ('SKU', 'CAMPAIGN', 'PROMOTION', 'SHIPMENT');
create table public.assignment_keys (
    id public.local_uuid primary key default private.uuid7(),
    kind public.assignment_kind not null,
    seller_namespace text check (length(btrim(seller_namespace)) > 0),
    amazon_scope text check (length(btrim(amazon_scope)) > 0),
    -- the SKU text, or Amazon's ID
    native_id text not null check (length(btrim(native_id)) > 0),
    current_version_id public.local_uuid,
    created_at timestamptz not null default now(),
    unique nulls not distinct (kind, seller_namespace, amazon_scope, native_id),
    unique (id, kind),
    check ((kind = 'SKU') = (seller_namespace is null)),
    check ((seller_namespace is null) = (amazon_scope is null))
);

-- Every change, with a memo. Blank = no key, no current version, or a current version without a
-- company. A blank produces an unassigned difference.
create table public.assignment_versions (
    id public.local_uuid primary key default private.uuid7(),
    key_id public.local_uuid not null,
    kind public.assignment_kind not null,
    version_number bigint not null check (version_number > 0),
    -- empty: an administrator cleared it
    company_id public.local_uuid references public.companies (id),
    origin text not null check (origin in ('ADMINISTRATOR', 'AUTOMATIC')),
    -- the administrator; empty when automatic
    set_by uuid references auth.users (id),
    -- an automatic version says so here
    memo text not null check (length(btrim(memo)) > 0),
    fee_period_count integer not null check (fee_period_count >= 0),
    created_at timestamptz not null default now(),
    foreign key (key_id, kind) references public.assignment_keys (id, kind),
    unique (key_id, version_number),
    unique (key_id, id),
    unique (id, kind),
    -- The cron job writes only the first version of a key, and it always names a company. So it
    -- never changes an assignment that an administrator set or cleared.
    check (
        origin <> 'AUTOMATIC' or (version_number = 1 and company_id is not null and set_by is null)
    ),
    check (kind <> 'SKU' or origin = 'ADMINISTRATOR'),               -- a SKU has no default
    check (kind = 'SKU' or fee_period_count = 0)                     -- fee rates exist only on SKUs
);
create index assignment_versions_company_idx on public.assignment_versions (company_id);
create index assignment_versions_set_by_idx on public.assignment_versions (set_by);
alter table public.assignment_keys add constraint assignment_keys_current_version
foreign key (id, current_version_id) references public.assignment_versions (key_id, id);

-- SelBox's fee rate of a SKU, per marketplace and period.
create table public.sku_fee_periods (
    id public.local_uuid primary key default private.uuid7(),
    assignment_version_id public.local_uuid not null,
    kind public.assignment_kind not null default 'SKU' check (kind = 'SKU'),
    marketplace_name public.marketplace_name not null,
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
    foreign key (assignment_version_id, kind) references public.assignment_versions (id, kind),
    exclude using gist (assignment_version_id with =, marketplace_name with =, valid_period with &&)
);
