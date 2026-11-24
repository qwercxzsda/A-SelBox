-- These are evidence or permanent identities: even trusted SQL cannot rewrite them.
do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.assignment_versions', 'public.sku_fee_periods',
        'private.currencies','private.source_acquisitions','private.source_preprocess_batches',
        'private.source_unit_versions','private.source_batch_units','private.finances_transactions',
        'private.finances_amounts','private.ad_invoices','private.ad_invoice_lines','private.storage_rows',
        'private.aged_storage_rows','private.removal_order_rows','private.inventory_ledger_rows',
        'private.inventory_acquisitions','public.company_payout_reports',
        'private.payout_report_source_versions','private.payout_report_assignment_versions'
    ] loop
        execute format('create trigger immutable before update or delete on %s
for each row execute function private.reject_mutation()', table_name);
        execute format('create trigger immutable_truncate before truncate on %s
for each statement execute function private.reject_mutation()', table_name);
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
        if actual > expected then
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
create trigger complete_period_insert
after insert on public.sku_fee_periods
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'public.assignment_versions', 'fee_period_count', 'assignment_version_id'
);
create constraint trigger complete_period_set
after insert on public.assignment_versions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'public.sku_fee_periods', 'fee_period_count', 'assignment_version_id'
);
create function private.guard_current_assignment() returns trigger
language plpgsql set search_path = '' as $$
declare chosen public.assignment_versions; previous_number bigint;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_version_id') is distinct from
        (to_jsonb(old) - 'current_version_id') then
        raise exception 'Assignment identity is immutable' using errcode = '23514';
    end if;
    if new.current_version_id is null then
        raise exception 'Publish an unassigned revision instead of clearing selection' using errcode = '23514';
    end if;
    if new.current_version_id is not distinct from old.current_version_id then return new; end if;
    select * into chosen from public.assignment_versions where id = new.current_version_id;
    if not found or chosen.key_id <> new.id then
        raise exception 'Selected version must belong to this assignment' using errcode = '23503';
    end if;
    select version_number into previous_number from public.assignment_versions where id = old.current_version_id;
    if previous_number is not null and chosen.version_number <= previous_number then
        raise exception 'Terms selection must advance through publication' using errcode = '23514';
    end if;
    return new;
end;
$$;
create trigger immutable_identity
before update or delete on public.assignment_keys
for each row execute function private.guard_current_assignment();

create function private.require_selected_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
    if exists (select 1 from public.assignment_keys where id = new.id and current_version_id is null) then
        raise exception 'An assignment requires a selected version' using errcode = '23514';
    end if;
    return null;
end;
$$;
create constraint trigger selected_terms_required
after insert on public.assignment_keys
deferrable initially deferred
for each row execute function private.require_selected_assignment();

create function private.require_read_committed() returns void language plpgsql
set search_path = '' as $$
begin
    if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'Source and payout publication require READ COMMITTED isolation'
            using errcode = '25000';
    end if;
end;
$$;

do $$
declare relation text;
begin
    foreach relation in array array[
        'public.assignment_keys', 'private.source_units'
    ] loop
        execute format('create trigger immutable_truncate before truncate on %s
for each statement execute function private.reject_mutation()', relation);
    end loop;
end;
$$;

-- Finance records are immutable; only the stable identity's selected observation changes.
create function private.guard_source_unit_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
    if tg_op = 'DELETE' or
        (to_jsonb(new) - array['current_version_id','current_batch_id']) is distinct from
        (to_jsonb(old) - array['current_version_id','current_batch_id']) then
        raise exception 'source unit identity is immutable' using errcode='23514';
    end if;
    if new.current_version_id is null or new.current_batch_id is null then
        raise exception 'source unit selection cannot be cleared' using errcode='23514';
    end if;
    return new;
end;
$$;
create trigger immutable_identity before update or delete on private.source_units
for each row execute function private.guard_source_unit_identity();

create function private.require_selected_source_version() returns trigger
language plpgsql set search_path = '' as $$
begin
    if exists(select 1 from private.source_units
        where id=new.id and (current_version_id is null or current_batch_id is null)) then
        raise exception 'A source unit requires a selected observation' using errcode='23514';
    end if;
    return null;
end;
$$;
create constraint trigger selected_source_version_required
after insert on private.source_units deferrable initially deferred
for each row execute function private.require_selected_source_version();


-- Reject late inserts into immutable child inventories, including inserts by trusted publishers.
do $$
declare entry record;
begin
    for entry in select * from (values
        ('private.source_batch_units','private.source_preprocess_batches','unit_count','batch_id'),
        ('private.payout_report_source_versions','public.company_payout_reports','source_version_count','report_id'),
        ('private.payout_report_assignment_versions','public.company_payout_reports','assignment_version_count','report_id')
    ) v(child,parent,count_field,foreign_key) loop
        execute format('create trigger freeze_child_inventory after insert on %s referencing new table as inserted_children
            for each statement execute function private.guard_child_inventory(%L,%L,%L)',
            entry.child,entry.parent,entry.count_field,entry.foreign_key);
        execute format('create constraint trigger %I after insert on %s deferrable initially deferred
            for each row execute function private.check_complete_inventory(%L,%L,%L)',
            'complete_'||entry.count_field,entry.parent,entry.child,entry.count_field,entry.foreign_key);
    end loop;
end;
$$;

create function private.check_source_batch() returns trigger language plpgsql set search_path
= '' as $$
declare acquisition private.source_acquisitions;
begin
    select * into strict acquisition from private.source_acquisitions where id=new.acquisition_id;
    if exists(select 1 from private.source_batch_units m join private.source_units u on u.id=m.unit_id
        where m.batch_id=new.id and (u.source,u.seller_namespace,u.amazon_scope)
            <> (acquisition.source,acquisition.seller_namespace,acquisition.amazon_scope)) then
        raise exception 'Batch unit belongs to a different Amazon source or account' using errcode='23503';
    end if;
    if acquisition.source not in ('SHIPMENT','CAMPAIGN','PROMOTION') and new.row_count<>(
        select coalesce(sum(v.row_count),0) from private.source_batch_units m
        join private.source_unit_versions v on v.id=m.version_id where m.batch_id=new.id) then
        raise exception 'Batch row count differs from its units' using errcode='23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_source_batch after insert on private.source_preprocess_batches
deferrable initially deferred for each row execute function private.check_source_batch();

create function private.check_unit_content() returns trigger language plpgsql set search_path
= '' as $$
declare actual_count bigint; child regclass;
begin
    child:=case new.source when 'FINANCES' then 'private.finances_amounts'::regclass
        when 'AD_INVOICE' then 'private.ad_invoice_lines'::regclass
        when 'STORAGE' then 'private.storage_rows'::regclass
        when 'AGED_STORAGE' then 'private.aged_storage_rows'::regclass
        when 'REMOVAL_ORDER' then 'private.removal_order_rows'::regclass
        when 'INVENTORY_LEDGER' then 'private.inventory_ledger_rows'::regclass end;
    execute format('select count(*) from %s where version_id=$1',child) into actual_count using new.id;
    if new.row_count<>actual_count or
        (new.source='FINANCES' and not exists(select 1 from private.finances_transactions
            where version_id=new.id and amount_count=new.row_count)) or
        (new.source='AD_INVOICE' and not exists(select 1 from private.ad_invoices
            where version_id=new.id and line_count=new.row_count)) then
        raise exception 'Incomplete source unit inventory' using errcode='23514';
    end if;
    return null;
end;
$$;
create constraint trigger complete_unit_content after insert on private.source_unit_versions
deferrable initially deferred for each row execute function private.check_unit_content();
do $$
declare child text;
begin
    foreach child in array array['finances_amounts','ad_invoice_lines','storage_rows','aged_storage_rows','removal_order_rows','inventory_ledger_rows'] loop
        execute format('create trigger freeze_unit_inventory after insert on private.%I referencing new table as inserted_children
            for each statement execute function private.guard_child_inventory(%L,%L,%L)',child,
            'private.source_unit_versions','row_count','version_id');
    end loop;
end;
$$;
