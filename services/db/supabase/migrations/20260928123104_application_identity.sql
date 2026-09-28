-- Caller-bound application roles and current ownership.
-- Authorization comes from database state, never user-editable JWT metadata.
create function private.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.app_accounts a
        where a.user_id = (select auth.uid()) and a.access_role = 'operator'
    );
$$;

-- Registered members may read current source references across companies.
-- Transaction ownership remains a separate fact-policy requirement.
create function private.is_company_member() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.app_accounts a
        where a.user_id = (select auth.uid()) and a.access_role = 'company_member'
    );
$$;

-- Project only the caller's currently owned SKUs. No caller-selected user or
-- company scope is accepted, and operator/history access stays in the policies.
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
    where a.user_id = (select auth.uid()) and a.access_role = 'company_member';
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
