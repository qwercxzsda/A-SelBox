revoke all on schema public, private from public;
revoke all on schema public, private from anon;
revoke all on schema public, private from authenticated;

revoke all on all tables in schema public, private from public;
revoke all on all tables in schema public, private from anon;
revoke all on all tables in schema public, private from authenticated;

revoke all on all functions in schema public, private from public;
revoke all on all functions in schema public, private from anon;
revoke all on all functions in schema public, private from authenticated;

revoke all on all sequences in schema public, private from public;
revoke all on all sequences in schema public, private from anon;
revoke all on all sequences in schema public, private from authenticated;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from public;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on sequences from anon;

alter default privileges in schema private revoke all on tables from public;
alter default privileges in schema private revoke all on tables from anon;
alter default privileges in schema private revoke all on functions from public;
alter default privileges in schema private revoke all on functions from anon;
alter default privileges in schema private revoke all on sequences from public;
alter default privileges in schema private revoke all on sequences from anon;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.get_company() to authenticated;

grant select
on public.companies,
public.company_fees
to authenticated;

grant select, insert, update, delete
on public.users_companies
to authenticated;

grant select
on private.order_transactions,
private.no_sku_transactions
to authenticated;

grant select
on public.order_transactions_view,
public.no_sku_transactions_view
to authenticated;

alter table public.companies enable row level security;
alter table public.company_fees enable row level security;
alter table public.users_companies enable row level security;

alter table private.settlements enable row level security;
alter table private.settlement_transactions enable row level security;
alter table private.admins enable row level security;
alter table private.preprocess_runs enable row level security;
alter table private.order_transactions enable row level security;
alter table private.settlement_transactions_order_transactions enable row level security;
alter table private.no_sku_transactions enable row level security;
alter table private.settlements_preprocess_runs enable row level security;

create policy admins_can_select_companies
on public.companies
for select
to authenticated
using ((select private.is_admin()));

create policy admins_can_select_company_fees
on public.company_fees
for select
to authenticated
using ((select private.is_admin()));

create policy admins_can_manage_users_companies
on public.users_companies
for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy admins_and_company_users_can_select_order_transactions
on private.order_transactions
for select
to authenticated
using (
    (select private.is_admin())
    or company_id = (select private.get_company())
);

create policy admins_and_company_users_can_select_no_sku_transactions
on private.no_sku_transactions
for select
to authenticated
using (
    (select private.is_admin())
    or company_id = (select private.get_company())
);
