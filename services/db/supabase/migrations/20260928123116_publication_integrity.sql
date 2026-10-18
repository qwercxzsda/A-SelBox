-- These are evidence or permanent identities: even trusted SQL cannot rewrite them.
do $$
declare table_name text;
begin
    foreach table_name in array array[
        'public.sku_terms_versions', 'public.sku_fee_periods',
        'private.finances_acquisitions', 'private.data_kiosk_acquisitions',
        'private.finances_preprocess_versions', 'private.finances_preprocess_batches',
        'private.finances_pruned_versions', 'private.finances_summary_checks',
        'private.finances_summary_check_versions', 'private.payout_report_finances_summary_checks',
        'private.data_kiosk_preprocess_batches', 'private.data_kiosk_preprocess_versions',
        'private.data_kiosk_pruned_versions',
        'private.inventory_acquisitions',
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_finances_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions', 'private.payout_report_reconciliation'
    ] loop
        execute format('create trigger immutable before update or delete on %s
for each row execute function private.reject_mutation()', table_name);
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
        execute format('create trigger no_truncate before truncate on %s
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
        if actual > expected or ((tg_table_name = 'data_kiosk_transactions' and exists (select 1 from private.data_kiosk_pruned_versions where version_id = parent_id))
          or (tg_table_name in ('finances_transactions','finances_transaction_components') and exists (select 1 from private.finances_pruned_versions where version_id = parent_id))) then
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
    'public.sku_terms_versions', 'fee_period_count', 'terms_version_id'
);
create constraint trigger complete_period_set
after insert on public.sku_terms_versions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'public.sku_fee_periods', 'fee_period_count', 'terms_version_id'
);
create trigger complete_finances_insert after insert
on private.finances_transaction_components
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.finances_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_finances_set
after insert on private.finances_preprocess_versions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.finances_transaction_components', 'row_count', 'version_id'
);
create trigger complete_day_insert
after insert on private.data_kiosk_transactions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_versions', 'row_count', 'version_id'
);
create constraint trigger complete_day_set
after insert on private.data_kiosk_preprocess_versions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.data_kiosk_transactions', 'row_count', 'version_id'
);
create trigger complete_batch_insert after insert
on private.data_kiosk_preprocess_versions
referencing new table as inserted_children for each statement
execute function private.guard_child_inventory(
    'private.data_kiosk_preprocess_batches', 'day_count', 'batch_id'
);
create constraint trigger complete_batch_set
after insert on private.data_kiosk_preprocess_batches
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.data_kiosk_preprocess_versions', 'day_count', 'batch_id'
);

create function private.guard_current_reference() returns trigger language plpgsql
set search_path = '' as $$
declare current_source record; previous_source record;
begin
    if tg_op = 'DELETE' or (to_jsonb(new) - 'current_version_id') is distinct from (to_jsonb(old) - 'current_version_id') then
        raise exception 'Published identity cannot change' using errcode = '23514';
    end if;
    if new.current_version_id is null or (tg_table_name not in ('data_kiosk_days','finances_days')
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
    if tg_table_name = 'finances_days' then
        if exists(select 1 from private.finances_pruned_versions where version_id=new.current_version_id) then
            raise exception 'A pruned Finances payload cannot become current' using errcode='23514';
        end if;
        select a.capture_started_at,a.id into current_source from private.finances_preprocess_versions v
            join private.finances_preprocess_batches b on b.id=v.batch_id join private.finances_acquisitions a on a.id=b.acquisition_id where v.id=new.current_version_id;
        select a.capture_started_at,a.id into previous_source from private.finances_preprocess_versions v
            join private.finances_preprocess_batches b on b.id=v.batch_id join private.finances_acquisitions a on a.id=b.acquisition_id where v.id=old.current_version_id;
        if old.current_version_id is not null and ((current_source.capture_started_at,current_source.id)<(previous_source.capture_started_at,previous_source.id)
            or (current_source.id=previous_source.id and new.current_version_id<=old.current_version_id)) then
            raise exception 'Finances observation selection cannot move backward' using errcode='23514';
        end if;
    end if;
    return new;
end;
$$;
create trigger immutable_identity
before update or delete on private.finances_days
for each row execute function private.guard_current_reference();
create trigger immutable_identity
before update or delete on private.data_kiosk_days
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
create trigger immutable_identity
before update or delete on public.skus
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
create constraint trigger selected_terms_required
after insert on public.skus
deferrable initially deferred
for each row execute function private.require_selected_sku_terms();

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
create trigger immutable
before update or delete on private.data_kiosk_transactions
for each row execute function private.guard_data_kiosk_payload_mutation();
revoke all on all functions in schema private from public, anon, authenticated, service_role;

do $$
declare relation text;
begin
    foreach relation in array array[
        'private.finances_transaction_components', 'private.data_kiosk_transactions',
        'private.inventory_acquisitions',
        'public.company_payout_reports', 'public.company_payout_report_components',
        'private.payout_report_finances_versions', 'private.payout_report_data_kiosk_versions',
        'private.payout_report_terms_versions', 'private.payout_report_reconciliation'
    ] loop
        execute format('create trigger immutable_truncate
before truncate on %s
for each statement execute function private.reject_mutation()', relation);
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
        ('private.payout_report_finances_versions', 'finances_version_count'),
        ('private.payout_report_data_kiosk_versions', 'data_kiosk_version_count'),
        ('private.payout_report_terms_versions', 'terms_version_count')
    loop
        execute format(
            'create trigger complete_report_insert
after insert on %s
referencing new table as inserted_children
for each statement execute function private.guard_child_inventory(%L,%L,%L)',
            child, 'public.company_payout_reports', count_field, 'report_id');
    end loop;
end;
$$;

create trigger complete_finances_native_insert
after insert on private.finances_transactions
referencing new table as inserted_children
for each statement execute function private.guard_child_inventory(
    'private.finances_preprocess_versions', 'transaction_count', 'version_id'
);
create constraint trigger complete_finances_native_set
after insert on private.finances_preprocess_versions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.finances_transactions', 'transaction_count', 'version_id'
);
create trigger complete_finances_batch_insert
after insert on private.finances_preprocess_versions
referencing new table as inserted_children
for each statement execute function private.guard_child_inventory(
    'private.finances_preprocess_batches', 'day_count', 'batch_id'
);
create constraint trigger complete_finances_batch_set
after insert on private.finances_preprocess_batches
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.finances_preprocess_versions', 'day_count', 'batch_id'
);
create trigger complete_finances_components_insert
after insert on private.finances_transaction_components
referencing new table as inserted_children
for each statement execute function private.guard_child_inventory(
    'private.finances_transactions', 'component_count', 'transaction_id'
);
create constraint trigger complete_finances_components_set
after insert on private.finances_transactions
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.finances_transaction_components', 'component_count', 'transaction_id'
);
create constraint trigger complete_finances_summary_set
after insert on private.finances_summary_checks
deferrable initially deferred
for each row execute function private.check_complete_inventory(
    'private.finances_summary_check_versions', 'version_count', 'check_id'
);
create trigger complete_finances_summary_insert
after insert on private.finances_summary_check_versions
referencing new table as inserted_children
for each statement execute function private.guard_child_inventory(
    'private.finances_summary_checks', 'version_count', 'check_id'
);

create function private.guard_finances_payload_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op<>'DELETE' or not exists(select 1 from private.finances_pruned_versions p where p.version_id=old.version_id) then
  raise exception 'Finances published facts are immutable' using errcode='23514';
 end if;
 return old;
end;
$$;
create trigger immutable
before update or delete on private.finances_transactions
for each row execute function private.guard_finances_payload_mutation();
create trigger immutable
before update or delete on private.finances_transaction_components
for each row execute function private.guard_finances_payload_mutation();
create trigger immutable_truncate
before truncate on private.finances_transactions
for each statement execute function private.reject_mutation();

create function private.validate_finances_parent_partition() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.activity_eligible is distinct from private.finances_activity_eligible(
   new.transaction_type,new.deferred_transaction_id,new.native_transaction_id,
   (select v.batch_id from private.finances_preprocess_versions v where v.id=new.version_id)) then
  raise exception 'Finances activity eligibility must follow its frozen capture links' using errcode='23514';
 end if;
 if not exists(select 1 from private.finances_preprocess_versions v join private.finances_days d on d.id=v.day_id
   where v.id=new.version_id and (d.seller_namespace,d.marketplace_name,d.activity_date)
     =(new.seller_namespace,new.marketplace_name,new.posted_date)) then
  raise exception 'Finances native transaction must belong to its complete day scope' using errcode='23514';
 end if;
 if exists(select 1 from private.finances_transaction_components c where c.transaction_id=new.id
   and (c.version_id,c.seller_namespace,c.native_transaction_id,c.marketplace_name,c.currency,c.posted_date,c.posted_at,
        c.transaction_type,c.transaction_status,c.account_type,c.activity_eligible,c.deferred_transaction_id,c.release_transaction_id,c.source_page_number,c.source_record_number)
   is distinct from (new.version_id,new.seller_namespace,new.native_transaction_id,new.marketplace_name,new.currency,new.posted_date,new.posted_at,
        new.transaction_type,new.transaction_status,new.account_type,new.activity_eligible,new.deferred_transaction_id,new.release_transaction_id,new.source_page_number,new.source_record_number))
   or (select coalesce(sum(amount),0) from private.finances_transaction_components where transaction_id=new.id)<>new.total_amount then
   raise exception 'Finances child amounts and metadata must match their native parent' using errcode='23514';
 end if;
 return null;
end;
$$;
create constraint trigger complete_finances_partition
after insert on private.finances_transactions
deferrable initially deferred
for each row execute function private.validate_finances_parent_partition();

create function private.validate_finances_summary_manifest() returns trigger
language plpgsql set search_path = '' as $$
declare actual_amount numeric; native_market_count integer;
begin
 select count(*)::integer into native_market_count from private.finances_acquisitions a
 cross join lateral jsonb_array_elements(a.api_metadata->'coverage_marketplaces') m
 where a.id=new.acquisition_id and private.finances_summary_marketplace(m->>'marketplace_name')=new.marketplace_name;
 if new.version_count<>(new.end_date-new.start_date+1)*native_market_count
  or exists(select 1 from private.finances_summary_check_versions m
    join private.finances_days d on d.id=m.day_id
    where m.check_id=new.id and (d.seller_namespace<>new.seller_namespace
      or private.finances_summary_marketplace(d.marketplace_name)<>new.marketplace_name or d.activity_date not between new.start_date and new.end_date)) then
  raise exception 'Summary manifest must cover exactly its local financial scope' using errcode='23514';
 end if;
 select coalesce(sum(t.total_amount),0) into actual_amount from private.finances_transactions t
 join private.finances_summary_check_versions m on m.version_id=t.version_id
 where m.check_id=new.id and t.activity_eligible and t.account_type=new.account_type and t.currency=new.currency;
 if actual_amount<>new.transaction_amount then
  raise exception 'Summary transaction total must equal its frozen native inputs' using errcode='23514';
 end if;
 return null;
end;
$$;
create constraint trigger complete_finances_summary_manifest
after insert on private.finances_summary_checks
deferrable initially deferred
for each row execute function private.validate_finances_summary_manifest();

create function private.validate_current_finances_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
 if exists(select 1 from private.finances_transactions candidate
  join private.finances_transactions other on other.seller_namespace=candidate.seller_namespace
   and other.native_transaction_id=candidate.native_transaction_id and other.id<>candidate.id
  join private.finances_days d on d.current_version_id=other.version_id
  where candidate.version_id=new.current_version_id
   and exists(select 1 from private.finances_days chosen where chosen.current_version_id=candidate.version_id)) then
  raise exception 'Native Finances transaction occurs in multiple current day versions' using errcode='23514';
 end if;
 return null;
end;
$$;
create constraint trigger unique_current_native_transactions
after insert or update on private.finances_days
deferrable initially deferred
for each row execute function private.validate_current_finances_identity();
