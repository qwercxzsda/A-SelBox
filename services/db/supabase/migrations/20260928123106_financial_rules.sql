-- Source differences are account information. Invoker table policies still apply.
create function private.financial_account_visible() returns boolean
language sql stable security invoker set search_path = '' as $$
    select not pg_catalog.row_security_active('private.settlement_transactions'::regclass)
        or private.is_operator();
$$;

-- Maturity assumes Settlement completion after two calendar months. Use a UTC
-- mature cutoff date so caller/session time zones cannot change the policy.
-- Dates before it are mature; the mature cutoff date and later are recent.
create function private.mature_cutoff_date()
returns date
language sql stable parallel safe security invoker set search_path = '' as $$
    select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date;
$$;

-- Shared relational ownership and current fee selection.
-- Scalar business rules stay inlinable: no SET clauses or data access.
-- Existing callers resolve these fully qualified helpers under their own scope.
create function private.settlement_fee_applicable(
    p_transaction_type text, p_amount_type text, p_amount_description text
) returns boolean
language sql immutable parallel safe security invoker as $$
    select p_transaction_type in ('Order', 'Refund')
        and p_amount_type = 'ItemPrice' and p_amount_description = 'Principal';
$$;

create function private.calculate_service_fee(p_fee_base numeric, p_fee_rate_percent numeric)
returns numeric
language sql immutable parallel safe security invoker as $$
    select -(p_fee_base * p_fee_rate_percent * 0.01);
$$;

-- Include explicitly unassigned current terms; their NULL company is part of
-- existing missing-ownership diagnostics. The invoker retains both tables' RLS.
create view private.current_sku_terms with (security_invoker = true) as
select
    s.id as seller_sku_id,
    s.seller_namespace,
    s.sku,
    v.id as terms_version_id,
    v.company_id
from public.seller_skus as s
inner join public.sku_terms_versions as v
    on s.id = v.seller_sku_id and s.current_terms_version_id = v.id;

revoke all on private.current_sku_terms from public, anon, authenticated, service_role;
revoke all on function private.settlement_fee_applicable(text, text, text),
private.calculate_service_fee(numeric, numeric) from public, anon, authenticated, service_role;

create view public.company_skus with (security_invoker = true) as
select
    seller_sku_id as id,
    seller_namespace,
    sku,
    company_id,
    terms_version_id
from private.current_sku_terms
where company_id is not null;

create view public.current_sku_fee_periods with (security_invoker = true) as
select
    s.id as seller_sku_id,
    s.company_id,
    s.terms_version_id,
    p.marketplace_name,
    p.id as fee_period_id,
    p.valid_period,
    p.fee_rate_percent
from public.company_skus as s
inner join public.sku_fee_periods as p on s.terms_version_id = p.terms_version_id;
