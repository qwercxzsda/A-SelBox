-- These are evidence or permanent identities: even trusted SQL cannot rewrite them.
do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.sku_terms_versions', 'public.sku_fee_periods',
        'private.settlement_acquisitions', 'private.data_kiosk_acquisitions',
        'private.settlement_preprocess_versions', 'private.settlement_transactions',
        'private.data_kiosk_preprocess_batches', 'private.data_kiosk_preprocess_versions',
        'private.data_kiosk_pruned_versions',
        'private.inventory_acquisitions',
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_settlement_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions', 'private.payout_report_reconciliation'
    ] loop
        execute format('create trigger immutable before update or delete on %s for each row execute function private.reject_mutation()', table_name);
    end loop;
end;
$$;

do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.skus', 'public.sku_terms_versions', 'public.sku_fee_periods',
        'private.data_kiosk_pruned_versions'
    ] loop
        execute format('create trigger no_truncate before truncate on %s for each statement execute function private.reject_mutation()', table_name);
    end loop;
end;
$$;

-- No signed-in or service API writer receives direct access to publication tables.
do $$
declare relation record;
begin
    for relation in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private') and c.relkind = 'r'
    loop
        execute format('alter table %I.%I enable row level security', relation.nspname, relation.relname);
        execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', relation.nspname, relation.relname);
    end loop;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
-- Objects are uploaded with immutable keys; client roles have no bucket policies.
insert into storage.buckets (id, name, public) values (
    'source-archives', 'source-archives', false
) on conflict (id) do update set public = false;

-- Count each affected parent once per INSERT statement, not once per child row.
-- Publishers insert each complete child set in one statement. Deferred parent
-- checks still reject incomplete transactions; immutable rows never reopen slots.
create function private.guard_child_inventory() returns trigger language plpgsql
set search_path = '' as $$
declare expected integer; actual bigint; parent_id uuid;
begin
    for parent_id in execute format('select distinct %I from inserted_children order by %I', tg_argv[2], tg_argv[2]) loop
        -- Compatible with the inserted children's FK key-share locks, while
        -- serializing inventory guards that address the same parent.
        execute format('select %I from %s where id = $1 for no key update', tg_argv[1], tg_argv[0])
            into expected using parent_id;
        if expected is null then raise exception 'Missing version parent' using errcode = '23503'; end if;
        execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, tg_argv[2])
            into actual using parent_id;
        if actual > expected or (tg_table_name = 'data_kiosk_transactions' and exists (
            select 1 from private.data_kiosk_pruned_versions where version_id = parent_id
        )) then
            raise exception 'Published child inventory is frozen' using errcode = '23514';
        end if;
    end loop;
    return null;
end;
$$;
create function private.check_complete_inventory() returns trigger language plpgsql
set search_path = '' as $$
declare expected integer; actual integer; parent_id uuid;
begin
    parent_id := (to_jsonb(new)->>'id')::uuid;
    expected := (to_jsonb(new)->>tg_argv[1])::integer;
    execute format('select count(*) from %s where %I = $1', tg_argv[0], tg_argv[2]) into actual using parent_id;
    if actual <> expected then raise exception 'Incomplete publication inventory: %', tg_table_name using errcode = '23514'; end if;
    return null;
end;
$$;
create trigger complete_period_insert after insert on public.sku_fee_periods
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'public.sku_terms_versions', 'fee_period_count', 'terms_version_id'
);
create constraint trigger complete_period_set after insert on public.sku_terms_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'public.sku_fee_periods', 'fee_period_count', 'terms_version_id'
);
create trigger complete_settlement_insert after insert
on private.settlement_transactions referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.settlement_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_settlement_set
after insert on private.settlement_preprocess_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.settlement_transactions', 'row_count', 'version_id'
);
create trigger complete_day_insert after insert on private.data_kiosk_transactions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_day_set after insert on private.data_kiosk_preprocess_versions
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.data_kiosk_transactions', 'row_count', 'version_id'
);
create trigger complete_batch_insert after insert
on private.data_kiosk_preprocess_versions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_batches', 'day_count', 'batch_id'
);
create constraint trigger complete_batch_set after insert on private.data_kiosk_preprocess_batches
deferrable initially deferred for each row execute function private.check_complete_inventory(
    'private.data_kiosk_preprocess_versions', 'day_count', 'batch_id'
);

create function private.guard_current_reference() returns trigger language plpgsql
set search_path = '' as $$
declare current_source record; previous_source record;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_version_id') is distinct from (to_jsonb(old) - 'current_version_id') then
        raise exception 'Published identity cannot change' using errcode = '23514';
    end if;
    if new.current_version_id is null or (tg_table_name <> 'data_kiosk_days'
        and old.current_version_id is not null and new.current_version_id <= old.current_version_id) then
        raise exception 'Current version must advance through publication' using errcode = '23514';
    end if;
    if tg_table_name = 'data_kiosk_days' then
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = new.current_version_id) then
            raise exception 'A pruned payload cannot become current' using errcode = '23514';
        end if;
        select a.root_query_created_at,a.id into current_source
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.id = new.current_version_id;
        select a.root_query_created_at,a.id into previous_source
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.id = old.current_version_id;
        if old.current_version_id is not null and (
            (current_source.root_query_created_at,current_source.id) < (previous_source.root_query_created_at,previous_source.id)
            or (current_source.id = previous_source.id and new.current_version_id <= old.current_version_id)
        ) then raise exception 'Data Kiosk observation selection cannot move backward' using errcode = '23514'; end if;
    end if;
    return new;
end;
$$;
create trigger immutable_identity before update or delete on private.settlements
for each row execute function private.guard_current_reference();
create trigger immutable_identity before update or delete on private.data_kiosk_days
for each row execute function private.guard_current_reference();

create function private.guard_current_sku_terms() returns trigger
language plpgsql set search_path = '' as $$
declare chosen public.sku_terms_versions; previous_number bigint;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_terms_version_id') is distinct from
        (to_jsonb(old) - 'current_terms_version_id') then
        raise exception 'SKU identity is immutable' using errcode = '23514';
    end if;
    if new.current_terms_version_id is null then
        raise exception 'Publish an unassigned revision instead of clearing selection' using errcode = '23514';
    end if;
    if new.current_terms_version_id is not distinct from old.current_terms_version_id then return new; end if;
    select * into chosen from public.sku_terms_versions where id = new.current_terms_version_id;
    if not found or chosen.sku_id <> new.id then
        raise exception 'Selected terms must belong to this SKU' using errcode = '23503';
    end if;
    if chosen.fee_period_count <> (
        select count(*) from public.sku_fee_periods where terms_version_id = chosen.id
    ) then raise exception 'Selected terms have an incomplete fee inventory' using errcode = '23514'; end if;
    select version_number into previous_number from public.sku_terms_versions where id = old.current_terms_version_id;
    if previous_number is not null and chosen.version_number <= previous_number then
        raise exception 'Terms selection must advance through publication' using errcode = '23514';
    end if;
    return new;
end;
$$;
create trigger immutable_identity before update or delete on public.skus
for each row execute function private.guard_current_sku_terms();

create function private.require_selected_sku_terms() returns trigger
language plpgsql set search_path = '' as $$
begin
    if exists (select 1 from public.skus where id = new.id and current_terms_version_id is null) then
        raise exception 'A registered SKU requires selected terms' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger selected_terms_required after insert on public.skus
deferrable initially deferred for each row execute function private.require_selected_sku_terms();

create function private.require_read_committed() returns void language plpgsql
set search_path = '' as $$
begin
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Source retention and payout publication require READ COMMITTED isolation'
            using errcode = '25000';
    end if;
end;
$$;

create function private.guard_data_kiosk_payload_mutation() returns trigger language plpgsql
set search_path = '' as $$
begin
    if tg_op <> 'DELETE' or not exists (
        select 1 from private.data_kiosk_pruned_versions p where p.version_id = old.version_id
    ) then raise exception 'Data Kiosk published facts are immutable' using errcode = '23514'; end if;
    return old;
end;
$$;
create trigger immutable before update or delete on private.data_kiosk_transactions
for each row execute function private.guard_data_kiosk_payload_mutation();
revoke all on all functions in schema private from public, anon, authenticated, service_role;

do $$
declare relation text;
begin
    foreach relation in array array[
        'private.settlement_transactions', 'private.data_kiosk_transactions',
        'private.inventory_acquisitions',
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_settlement_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions', 'private.payout_report_reconciliation'
    ] loop
        execute format('create trigger immutable_truncate before truncate on %s for each statement execute function private.reject_mutation()', relation);
    end loop;
end;
$$;

-- Counts describe immutable inventories, not user-entered business terms.
do $$
declare child text; count_field text;
begin
    for child, count_field in values
        ('public.company_payout_report_components', 'component_count'),
        ('private.payout_report_reconciliation', 'reconciliation_count'),
        ('private.payout_report_settlement_versions', 'settlement_version_count'),
        ('private.payout_report_data_kiosk_versions', 'data_kiosk_version_count'),
        ('private.payout_report_terms_versions', 'terms_version_count')
    loop
        execute format(
            'create trigger complete_report_insert after insert on %s referencing new table as inserted_children for each statement execute function private.guard_child_inventory(%L,%L,%L)',
            child, 'public.company_payout_reports', count_field, 'report_id');
    end loop;
end;
$$;
