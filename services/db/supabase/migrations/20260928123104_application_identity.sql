-- Caller-bound application roles and current ownership.
-- Authorization comes from database state, never user-editable JWT metadata.
create function private.is_administrator() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.app_accounts a
        where a.user_id = (select auth.uid()) and a.access_role = 'administrator'
    );
$$;

-- Registered members may read current source references across companies.
-- Transaction ownership remains a separate fact-policy requirement.
create function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.app_accounts a
        where a.user_id = (select auth.uid()) and a.access_role = 'member'
    );
$$;

-- Application company creation is idempotent without restricting trusted imports.
-- The name lock serializes equivalent requests; existing display spelling wins.
create function private.create_administrator_company(company_name text)
returns table (id uuid, name text, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
    cleaned_name text;
    normalized_name text;
    company public.companies;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    cleaned_name := regexp_replace(company_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if cleaned_name is null or char_length(cleaned_name) not between 1 and 200 then
        raise exception 'Company name must contain 1 to 200 characters' using errcode = '22023';
    end if;
    normalized_name := lower(cleaned_name);
    perform pg_advisory_xact_lock(1936028271, hashtext(normalized_name));
    select * into company from public.companies as c
    where lower(regexp_replace(c.name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) = normalized_name
    order by c.created_at, c.id limit 1;
    if found then
        return query select company.id::uuid, company.name, false;
        return;
    end if;
    insert into public.companies as c (name) values (cleaned_name) returning c.* into company;
    return query select company.id::uuid, company.name, true;
end;
$$;
create function public.create_company(company_name text)
returns table (id uuid, name text, created boolean)
language sql security invoker set search_path = '' as $$
    select * from private.create_administrator_company(company_name);
$$;

-- Signup grants no company access, regardless of user-editable Auth metadata.
create function private.create_unassigned_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into public.app_accounts (user_id) values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;
create trigger create_unassigned_account after insert on auth.users
for each row execute function private.create_unassigned_account();

insert into public.app_accounts (user_id)
select id from auth.users on conflict (user_id) do nothing;

-- Auth remains private. Only administrators can obtain the minimal email roster.
create function private.read_account_directory() returns table (
    user_id uuid, email text, access_role public.app_access_role,
    company_id uuid, created_at timestamptz, email_confirmed boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    return query
    select a.user_id, u.email::text, a.access_role, a.company_id::uuid,
        a.created_at, u.email_confirmed_at is not null
    from public.app_accounts as a join auth.users as u on u.id = a.user_id;
end;
$$;
create function public.account_directory() returns table (
    user_id uuid, email text, access_role public.app_access_role,
    company_id uuid, created_at timestamptz, email_confirmed boolean
)
language sql stable security invoker set search_path = '' as $$
    select * from private.read_account_directory();
$$;

-- One guarded mutation replaces raw account writes. Lock before checking the
-- target's role so concurrent DB promotion cannot be overwritten by a member edit.
create function private.set_administrator_company_membership(
    target_user_id uuid, target_company_id uuid,
    expected_access_role public.app_access_role, expected_company_id uuid
) returns setof public.app_accounts
language plpgsql security definer set search_path = '' as $$
declare target public.app_accounts;
begin
    if not private.is_administrator() then
        raise exception 'Administrator access required' using errcode = '42501';
    end if;
    select * into target from public.app_accounts as a
    where a.user_id = target_user_id for update;
    if not found then
        raise exception 'Account not found' using errcode = 'P0002';
    end if;
    if target.access_role = 'administrator' then
        raise exception 'Administrator access can only be changed by the DB manager'
        using errcode = '42501';
    end if;
    if target.access_role is distinct from expected_access_role
        or target.company_id is distinct from expected_company_id then
        raise exception 'Account membership changed while editing' using errcode = 'PT409';
    end if;
    return query
    update public.app_accounts as a
    set access_role = case when target_company_id is null
            then 'unassigned'::public.app_access_role
            else 'member'::public.app_access_role end,
        company_id = target_company_id
    where a.user_id = target_user_id returning a.*;
end;
$$;
create function public.set_company_membership(
    target_user_id uuid, target_company_id uuid,
    expected_access_role public.app_access_role, expected_company_id uuid
)
returns setof public.app_accounts
language sql security invoker set search_path = '' as $$
    select * from private.set_administrator_company_membership(
        target_user_id, target_company_id, expected_access_role, expected_company_id
    );
$$;

-- There is deliberately no public wrapper or application-role execution grant.
-- DB managers call this through the trusted Python repository with DB credentials.
create function private.set_administrator_access(target_user_id uuid, enabled boolean)
returns setof public.app_accounts
language plpgsql security invoker set search_path = '' as $$
declare target public.app_accounts;
begin
    if enabled is null then
        raise exception 'Administrator access must be enabled or disabled'
        using errcode = '22023';
    end if;
    select * into target from public.app_accounts as a
    where a.user_id = target_user_id for update;
    if not found then
        raise exception 'Account not found' using errcode = 'P0002';
    end if;
    if enabled or target.access_role = 'administrator' then
        update public.app_accounts as a
        set access_role = case when enabled then 'administrator'::public.app_access_role
                else 'unassigned'::public.app_access_role end,
            company_id = null
        where a.user_id = target_user_id;
    end if;
    return query select * from public.app_accounts as a where a.user_id = target_user_id;
end;
$$;

-- Project only the caller's currently owned SKUs. No caller-selected user or
-- company scope is accepted, and administrator/history access stays in the policies.
-- Reading the underlying tables here avoids their mutually dependent RLS paths.
-- Source namespaces never restrict ownership of the same exact SKU text.
create function private.current_owned_sku_terms() returns table (
    sku_id uuid, sku text, terms_version_id uuid
)
language sql stable security definer set search_path = '' as $$
    select s.id::uuid, s.sku, v.id::uuid
    from public.app_accounts as a
    join public.sku_terms_versions as v on v.company_id = a.company_id
    join public.skus as s
        on s.id = v.sku_id and s.current_terms_version_id = v.id
    where a.user_id = (select auth.uid()) and a.access_role = 'member';
$$;

-- Include explicitly unassigned current terms; their NULL company is part of
-- existing missing-ownership diagnostics. The invoker retains both tables' RLS.
create view private.current_sku_terms with (security_invoker = true) as
select
    s.id as sku_id,
    s.sku,
    v.id as terms_version_id,
    v.company_id
from public.skus as s
inner join public.sku_terms_versions as v
    on s.id = v.sku_id and s.current_terms_version_id = v.id;

revoke all on private.current_sku_terms from public, anon, authenticated, service_role;
create view public.company_skus with (security_invoker = true) as
select
    sku_id as id,
    sku,
    company_id,
    terms_version_id
from private.current_sku_terms
where company_id is not null;

create view public.current_sku_fee_periods with (security_invoker = true) as
select
    s.id as sku_id,
    s.company_id,
    s.terms_version_id,
    p.marketplace_name,
    p.id as fee_period_id,
    p.valid_period,
    p.fee_rate_percent
from public.company_skus as s
inner join public.sku_fee_periods as p on s.terms_version_id = p.terms_version_id;
