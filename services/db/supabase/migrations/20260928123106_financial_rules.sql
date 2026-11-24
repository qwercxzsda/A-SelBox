-- Source differences are account information. Invoker table policies still apply.
create function private.financial_account_visible() returns boolean
language sql stable security invoker set search_path = '' as $$
    select not pg_catalog.row_security_active('private.finances_amounts'::regclass)
        or private.is_administrator();
$$;

-- Payout eligibility waits two calendar months; this never selects a transaction's
-- authoritative source. UTC makes the payout boundary independent of session time zones.
create function private.mature_cutoff_date()
returns date
language sql stable parallel safe security invoker set search_path = '' as $$
    select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date;
$$;

-- Shared relational ownership and current fee selection.
-- Scalar business rules stay inlinable: no SET clauses or data access.
-- Existing callers resolve these fully qualified helpers under their own scope.
create function private.calculate_service_fee(p_fee_base numeric, p_fee_rate_percent numeric)
returns numeric
language sql immutable parallel safe security invoker as $$
    select -(p_fee_base * p_fee_rate_percent * 0.01);
$$;

revoke all on function private.calculate_service_fee(numeric, numeric) from public,
anon,
authenticated,
service_role;

create view private.current_reference_assignments with (security_invoker = true) as
select
    k.kind::text as kind,
    k.seller_namespace,
    k.amazon_scope,
    k.native_id as native_key,
    v.id,
    v.company_id,
    v.origin as assignment_origin,
    v.memo,
    v.set_by,
    v.version_number
from public.assignment_keys as k
inner join public.assignment_versions as v on k.current_version_id = v.id
where k.kind <> 'SKU';

-- Scope every Amazon identifier by regional account. SKU ownership is global.
create view private.assignment_candidates with (security_invoker = true) as
with keys as (
    select
        source::text as kind,
        seller_namespace,
        amazon_scope,
        native_key
    from private.reference_id_requests
    where source in ('PROMOTION', 'CAMPAIGN', 'SHIPMENT')
    union
    select
        source::text,
        seller_namespace,
        amazon_scope,
        native_key
    from private.information_keys
    union
    select
        kind,
        seller_namespace,
        amazon_scope,
        native_key
    from private.current_reference_assignments
),

l as (
    select
        r.seller_namespace,
        r.amazon_scope,
        r.asin,
        r.sku
    from private.inventory_ledger_rows as r
    inner join private.source_units as u on r.version_id = u.current_version_id
),

products as (
    select distinct
        k.*,
        i.asin,
        coalesce(i.sku, l.sku) as sku
    from keys as k left join private.information_products as i
        on
            (i.source, i.seller_namespace, i.amazon_scope, i.native_key)
            = (k.kind, k.seller_namespace, k.amazon_scope, k.native_key)
    left join l on
        i.sku is null and i.asin = l.asin
        and (l.seller_namespace, l.amazon_scope) = (k.seller_namespace, k.amazon_scope)
),

candidates as (
    select
        p.kind,
        p.seller_namespace,
        p.amazon_scope,
        p.native_key,
        coalesce(array_agg(distinct p.sku order by p.sku) filter (where p.sku is not null), '{}')
            as skus,
        coalesce(jsonb_agg(
            jsonb_build_object('sku', p.sku, 'asin', p.asin, 'company_id', s.company_id)
            order by p.sku, p.asin
        ) filter (where p.sku is not null or p.asin is not null
        ), '[]') as products,
        case
            when count(*) = count(s.company_id) and count(distinct s.company_id) = 1
                then min(s.company_id::text)::uuid
        end as suggested_company_id
    from products as p left join private.current_sku_terms as s on p.sku = s.sku
    group by p.kind, p.seller_namespace, p.amazon_scope, p.native_key
)

select
    c.*,
    a.company_id,
    a.assignment_origin,
    a.id as current_version_id,
    case
        when a.company_id is null then 'NO_ASSIGNMENT'
        when exists (
            select 1
            from private.current_sku_terms as terms
            where
                terms.sku = any(c.skus)
                and terms.company_id <> a.company_id
        ) then 'PRODUCTS_DISAGREE'
    end as warning
from candidates as c
left join
    private.current_reference_assignments as a
    on
        c.kind = a.kind and c.seller_namespace = a.seller_namespace
        and c.amazon_scope = a.amazon_scope and c.native_key = a.native_key;

create function private.write_reference_assignment(
    p_kind text, p_seller_namespace text, p_amazon_scope text,
    p_native_key text,
    p_company_id uuid,
    p_expected_version_id uuid,
    p_memo text,
    p_automatic boolean
)
returns uuid language plpgsql set search_path = '' as $$
declare
    identity public.assignment_keys;
    previous public.assignment_versions;
    result uuid;
begin
    perform private.lock_payout_report_inputs();
    insert into public.assignment_keys(kind, seller_namespace, amazon_scope, native_id)
        values(p_kind::public.assignment_kind,p_seller_namespace,p_amazon_scope,p_native_key)
        on conflict(kind,seller_namespace,amazon_scope,native_id) do nothing;
    select * into strict identity from public.assignment_keys
        where (kind,seller_namespace,amazon_scope,native_id)=
            (p_kind::public.assignment_kind,p_seller_namespace,p_amazon_scope,p_native_key)
        for update;
    select * into previous from public.assignment_versions where id=identity.current_version_id;
    if p_automatic and previous.id is not null then return previous.id; end if;
    if previous.id is distinct from p_expected_version_id then
        raise exception 'Assignment changed while editing' using errcode='PT409';
    end if;
    insert into public.assignment_versions(key_id,kind,version_number,company_id,origin,set_by,memo,fee_period_count)
        values(identity.id,identity.kind,coalesce(previous.version_number,0)+1,p_company_id,
            case when p_automatic then 'AUTOMATIC' else 'ADMINISTRATOR' end,
            case when not p_automatic then auth.uid() end,p_memo,0)
        returning id into result;
    update public.assignment_keys set current_version_id=result where id=identity.id;
    perform private.request_all_payout_report_refreshes();
    return result;
end;
$$;
create function private.assign_reference_as_admin(
    p_seller_namespace text, p_amazon_scope text, p_kind text,
    p_native_key text, p_company_id uuid, p_expected_version_id uuid, p_memo text
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
    if not private.is_administrator() then raise insufficient_privilege; end if;
    if not exists(select 1 from private.assignment_candidates where
        (kind,seller_namespace,amazon_scope,native_key)=(p_kind,p_seller_namespace,p_amazon_scope,p_native_key)) then
        raise exception 'Unknown assignment key' using errcode='22023';
    end if;
    return private.write_reference_assignment(p_kind,p_seller_namespace,p_amazon_scope,p_native_key,
        p_company_id,p_expected_version_id,p_memo,false);
end;
$$;
create function public.set_reference_assignment(
    p_seller_namespace text, p_amazon_scope text, p_kind text,
    p_native_key text, p_company_id uuid, p_expected_version_id uuid, p_memo text
)
returns uuid language sql security invoker set search_path = '' as $$
    select private.assign_reference_as_admin(p_seller_namespace,p_amazon_scope,p_kind,p_native_key,p_company_id,p_expected_version_id,p_memo);
$$;
create function private.default_reference_assignments() returns integer
language plpgsql set search_path
= '' as $$
declare r record; applied integer:=0;
begin
    -- Serialize ownership changes with candidate selection so a changed SKU cannot
    -- supply a stale default. Read-only attribution remains lock free.
    perform pg_advisory_xact_lock(hashtextextended('company_payout_inputs',0));
    for r in select * from private.assignment_candidates where current_version_id is null and suggested_company_id is not null
        order by kind,seller_namespace,amazon_scope,native_key loop
        perform private.write_reference_assignment(r.kind,r.seller_namespace,r.amazon_scope,r.native_key,
            r.suggested_company_id,r.current_version_id,'Automatically assigned from product ownership',true);
        applied:=applied+1;
    end loop;
    return applied;
end;
$$;
create view public.assignment_status with (security_invoker = true) as
select
    kind,
    seller_namespace,
    amazon_scope,
    native_key,
    skus,
    products,
    suggested_company_id,
    company_id,
    assignment_origin,
    current_version_id,
    warning
from private.assignment_candidates
where private.is_administrator();
