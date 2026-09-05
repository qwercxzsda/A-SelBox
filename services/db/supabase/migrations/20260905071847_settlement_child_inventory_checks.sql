-- Recheck Settlement counts after child inserts, including after early validation.

create or replace function private.enforce_settlement_report_content_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    report_id uuid;
    declared_count bigint;
    stored_count bigint;
begin
    if tg_table_name = 'settlement_reports' then
        report_id := new.id;
    else
        report_id := new.settlement_report_id;
    end if;

    select settlement_report.content_row_count
    into declared_count
    from private.settlement_reports as settlement_report
    where settlement_report.id = report_id;

    if not found then
        raise exception 'Settlement content references an unknown report.';
    end if;

    select count(*)
    into stored_count
    from private.settlement_report_rows as report_row
    where report_row.settlement_report_id = report_id;

    if stored_count <> declared_count then
        raise exception
            'Settlement report % has % content rows but declares %.',
            report_id,
            stored_count,
            declared_count;
    end if;

    return new;
end;
$$;

create or replace function private.enforce_settlement_processing_inventory()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    processing_id uuid;
    declared_entry_count bigint;
    declared_result_count bigint;
    stored_entry_count bigint;
    stored_result_count bigint;
begin
    if tg_table_name = 'settlement_processing_logs' then
        processing_id := new.id;
    else
        processing_id := new.processing_log_id;
    end if;

    select
        processed_report.processed_entry_count,
        processed_report.processed_result_count
    into
        declared_entry_count,
        declared_result_count
    from private.settlement_processed_reports as processed_report
    where processed_report.processing_log_id = processing_id;

    if not found then
        raise exception 'Settlement processing log has no processed report.';
    end if;

    select count(*)
    into stored_entry_count
    from private.settlement_processed_entries as processed_entry
    where processed_entry.processing_log_id = processing_id;

    select count(*)
    into stored_result_count
    from private.settlement_processed_results as processed_result
    where processed_result.processing_log_id = processing_id;

    if stored_entry_count <> declared_entry_count
       or stored_result_count <> declared_result_count
    then
        raise exception
            'Settlement processing log % has incomplete output inventory.',
            processing_id;
    end if;

    return new;
end;
$$;

create constraint trigger enforce_settlement_report_row_content_count
after insert
on private.settlement_report_rows
deferrable initially deferred
for each row
execute function private.enforce_settlement_report_content_count();

create constraint trigger enforce_settlement_processed_report_inventory
after insert
on private.settlement_processed_reports
deferrable initially deferred
for each row
execute function private.enforce_settlement_processing_inventory();

create constraint trigger enforce_settlement_processed_entry_inventory
after insert
on private.settlement_processed_entries
deferrable initially deferred
for each row
execute function private.enforce_settlement_processing_inventory();

create constraint trigger enforce_settlement_processed_result_inventory
after insert
on private.settlement_processed_results
deferrable initially deferred
for each row
execute function private.enforce_settlement_processing_inventory();
