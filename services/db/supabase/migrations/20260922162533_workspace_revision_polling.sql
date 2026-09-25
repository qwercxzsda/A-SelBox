-- Opaque publication tokens make polling independent of transaction-table size.
-- Source tokens are global; fee tokens also have a company scope. The nil UUID
-- is an internal global scope and is never accepted from an API caller.
-- Company IDs use public.local_uuid (UUIDv7), which rejects this nil UUID.
create table private.workspace_revision_tokens (
    source text not null check (source in ('settlement', 'data_kiosk', 'fees')), -- noqa: RF04
    scope_company_id uuid not null,
    revision uuid not null default gen_random_uuid(),
    changed_in xid8 not null default pg_current_xact_id(),
    primary key (source, scope_company_id),
    check (source = 'fees' or scope_company_id = '00000000-0000-0000-0000-000000000000')
);
alter table private.workspace_revision_tokens enable row level security;
revoke all on private.workspace_revision_tokens from public, anon, authenticated, service_role;

create function private.bump_workspace_revision(p_source text, p_companies uuid[])
returns void language sql set search_path = '' as $$
    insert into private.workspace_revision_tokens (source, scope_company_id)
    select p_source, c.company_id from (
        select distinct company_id from unnest(
            array['00000000-0000-0000-0000-000000000000'::uuid] || p_companies
        ) as scopes(company_id) where company_id is not null
    ) as c order by c.company_id
    on conflict (source, scope_company_id) do update
    set revision = excluded.revision, changed_in = excluded.changed_in
    where workspace_revision_tokens.changed_in is distinct from excluded.changed_in;
$$;

create function private.track_source_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' and new.current_version_id is not distinct from old.current_version_id then
        return null;
    end if;
    if tg_op = 'INSERT' and new.current_version_id is null then return null; end if;
    if tg_op = 'DELETE' and old.current_version_id is null then return null; end if;
    perform private.bump_workspace_revision(tg_argv[0], '{}'::uuid[]);
    return null;
end;
$$;

-- Delay the tiny shared-row write until the publication has finished inserting
-- its facts. Multi-day batches rotate each source token at most once per commit.
create constraint trigger workspace_settlement_revision
after insert or update or delete on private.settlements
deferrable initially deferred for each row
execute function private.track_source_revision('settlement');
create constraint trigger workspace_data_kiosk_revision
after insert or update or delete on private.data_kiosk_days
deferrable initially deferred for each row
execute function private.track_source_revision('data_kiosk');

create function private.track_fee_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected_companies uuid[];
begin
    if tg_table_name = 'companies' then
        if tg_op = 'UPDATE' and new.name is not distinct from old.name then return null; end if;
        affected_companies := case when tg_op = 'DELETE' then array[old.id::uuid]
            else array[new.id::uuid] end;
    else
        if tg_op = 'UPDATE' and new.current_terms_version_id is not distinct from old.current_terms_version_id then
            return null;
        end if;
        -- Terms history rejects UPDATE, DELETE, and TRUNCATE, so even a later
        -- selection in this transaction cannot erase either captured owner.
        select array_agg(v.company_id::uuid) into affected_companies
        from public.sku_terms_versions as v
        where v.id in (
            case when tg_op <> 'DELETE' then new.current_terms_version_id end,
            case when tg_op <> 'INSERT' then old.current_terms_version_id end
        );
        if tg_op = 'INSERT' and new.current_terms_version_id is null then return null; end if;
    end if;
    perform private.bump_workspace_revision('fees', coalesce(affected_companies, '{}'::uuid[]));
    return null;
end;
$$;

-- Ownership changes affect fee calculations AND which transactions are visible.
-- Both previous and next owners receive the new token. Company names use the
-- same dependency because fee/transaction labels also depend on that lookup.
create constraint trigger workspace_terms_revision
after insert or update or delete on public.seller_skus
deferrable initially deferred for each row execute function private.track_fee_revision();
create constraint trigger workspace_company_revision
after insert or update or delete on public.companies
deferrable initially deferred for each row execute function private.track_fee_revision();

create function private.read_workspace_revisions(p_sources text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare account public.app_accounts; revisions jsonb;
begin
    select * into account from public.app_accounts as a where a.user_id = auth.uid();
    if not found then raise exception 'Application access required' using errcode = '42501'; end if;
    if p_sources is null or cardinality(p_sources) > 3 or array_ndims(p_sources) > 1
        or exists (select 1 from unnest(p_sources) as s(source)
            where source is null or source not in ('settlement', 'data_kiosk', 'fees')) then
        raise exception 'Invalid revision sources' using errcode = '22023';
    end if;
    select coalesce(jsonb_object_agg(s.source, coalesce(r.revision::text, '0')), '{}'::jsonb)
    into revisions
    from (select distinct source from unnest(p_sources) as requested(source)) as s
    left join private.workspace_revision_tokens as r on r.source = s.source
        and r.scope_company_id = case
            when s.source = 'fees' and account.access_role = 'company_member' then account.company_id::uuid
            else '00000000-0000-0000-0000-000000000000'::uuid end;
    return jsonb_build_object(
        'account', jsonb_build_object('user_id', account.user_id,
            'access_role', account.access_role, 'company_id', account.company_id),
        'revisions', revisions
    );
end;
$$;

create function public.workspace_revisions(
    p_sources text[] default array['settlement', 'data_kiosk', 'fees']::text[]
) returns jsonb language sql stable security invoker set search_path = '' as $$
    select private.read_workspace_revisions(p_sources);
$$;

revoke all on function private.bump_workspace_revision(text, uuid[]),
private.track_source_revision(), private.track_fee_revision(),
private.read_workspace_revisions(text[]), public.workspace_revisions(text[])
from public, anon, authenticated, service_role;
grant execute on function private.read_workspace_revisions(text[]),
public.workspace_revisions(text[]) to authenticated;

comment on function public.workspace_revisions(text[]) is
'Opaque change tokens for published sources and authorized fees/ownership/labels.';
notify pgrst, 'reload schema';
