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
create function private.current_owned_sku_terms() returns table (
    seller_sku_id uuid, seller_namespace text, sku text, terms_version_id uuid
)
language sql stable security definer set search_path = '' as $$
    select s.id::uuid, s.seller_namespace, s.sku, v.id::uuid
    from public.app_accounts as a
    join public.sku_terms_versions as v on v.company_id = a.company_id
    join public.seller_skus as s
        on s.id = v.seller_sku_id and s.current_terms_version_id = v.id
    where a.user_id = (select auth.uid()) and a.access_role = 'company_member';
$$;
