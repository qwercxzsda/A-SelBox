-- Child inserts must recheck inventories even after the parent check already passed.
-- Existing lifecycle fixtures provide both a complete one-row report and an empty report.
do $$
declare
    processing_id uuid := gen_random_uuid();
    defer_child_check boolean;
    insertion_completed boolean;
    rejected boolean;
    insertion record;
begin
    set constraints all deferred;
    insert into private.settlement_processing_logs (
        id, settlement_report_id, processor_version
    ) values (
        processing_id, '10000000-0000-0000-0000-000000000001', 'inventory-timing-test'
    );
    insert into private.settlement_processed_reports (
        processing_log_id, settlement_report_id, settlement_id,
        settlement_start_at, settlement_end_at, deposit_at, total_amount, currency,
        settlement_start_date, settlement_end_date, processed_entry_count, processed_result_count
    ) values (
        processing_id, '10000000-0000-0000-0000-000000000001', 'SYNTHETIC',
        '2026-09-01', '2026-09-01', '2026-09-01', 0, 'USD',
        '2026-09-01', '2026-09-01', 0, 0
    );

    -- Complete zero-entry/result and existing one-entry/result batches all pass.
    set constraints all immediate;

    foreach defer_child_check in array array[false, true] loop
        for insertion in
            select * from (values
                (
                    'raw row',
                    $insert$
                        insert into private.settlement_report_rows (
                            settlement_report_id, source_line_number, column_values
                        ) values (
                            '10000000-0000-0000-0000-000000000098',
                            3, array['SYNTHETIC', '0']
                        )
                    $insert$,
                    'Settlement report 10000000-0000-0000-0000-000000000098 '
                        || 'has 1 content rows but declares 0.'
                ),
                (
                    'processed entry',
                    format($insert$
                        insert into private.settlement_processed_entries (
                            processing_log_id, settlement_report_id, settlement_report_row_id,
                            source_line_number, posted_date, posted_at, currency, settlement_amount,
                            transaction_type, amount_type, amount_description,
                            category_code, pnl_treatment, handling_method
                        ) values (
                            %L, '10000000-0000-0000-0000-000000000001',
                            '11000000-0000-0000-0000-000000000001',
                            9, '2026-09-01', '2026-09-01', 'USD', 0,
                            'Synthetic', 'Synthetic', 'Synthetic',
                            'UNMAPPED', 'SKU_PNL', 'UNASSIGNED'
                        )
                    $insert$, processing_id),
                    format(
                        'Settlement processing log %s has incomplete output inventory.', processing_id
                    )
                ),
                (
                    'processed result',
                    format($insert$
                        insert into private.settlement_processed_results (
                            processing_log_id, settlement_report_id, category_code, pnl_treatment,
                            allocation_method, activity_start_date, activity_end_date,
                            currency, settlement_amount
                        ) values (
                            %L, '10000000-0000-0000-0000-000000000001',
                            'UNMAPPED', 'SKU_PNL', 'UNASSIGNED',
                            '2026-09-01', '2026-09-01', 'USD', 0
                        )
                    $insert$, processing_id),
                    format(
                        'Settlement processing log %s has incomplete output inventory.', processing_id
                    )
                )
            ) as candidate (description, statement, expected_error)
        loop
            if defer_child_check then
                set constraints all deferred;
            end if;
            rejected := false;
            insertion_completed := false;
            begin
                execute insertion.statement;
                insertion_completed := true;
                if defer_child_check then
                    set constraints all immediate;
                end if;
            exception when raise_exception then
                if sqlerrm <> insertion.expected_error then
                    raise;
                end if;
                rejected := true;
            end;
            if not rejected or insertion_completed is distinct from defer_child_check then
                raise exception 'Wrong inventory validation timing for %, deferred = %.',
                    insertion.description, defer_child_check;
            end if;

            -- Each rejected insertion rolls back its savepoint and pending trigger events.
            set constraints all immediate;
        end loop;
    end loop;
    set constraints all deferred;
end;
$$;

-- Multiple child rows also succeed when a complete batch is assembled while deferred.
do $$
declare
    report_id uuid := gen_random_uuid();
    processing_id uuid := gen_random_uuid();
begin
    insert into private.settlement_reports (
        id, seller_namespace, amazon_scope, amazon_report_id, amazon_document_id,
        amazon_report_created_at, marketplace_ids, marketplace_names, tsv_columns,
        metadata_values, metadata_source_line_number, decoded_content_sha256, content_row_count
    ) values (
        report_id, '__TEST__', 'NA', report_id::text, report_id::text,
        '2026-09-01', array['TEST_MARKETPLACE'], array['Test Marketplace'],
        array['settlement-id', 'amount'], array['SYNTHETIC', '0'], 2, repeat('0', 64), 2
    );
    insert into private.settlement_report_rows (
        settlement_report_id, source_line_number, column_values
    )
    select report_id, source_line, array['SYNTHETIC', '0']
    from generate_series(3, 4) as source_line;

    insert into private.settlement_processing_logs (
        id, settlement_report_id, processor_version
    ) values (processing_id, report_id, 'inventory-multiple-rows-test');
    insert into private.settlement_processed_reports (
        processing_log_id, settlement_report_id, settlement_id,
        settlement_start_at, settlement_end_at, deposit_at, total_amount, currency,
        settlement_start_date, settlement_end_date, processed_entry_count, processed_result_count
    ) values (
        processing_id, report_id, 'SYNTHETIC',
        '2026-09-01', '2026-09-01', '2026-09-01', 0, 'USD',
        '2026-09-01', '2026-09-01', 2, 2
    );
    insert into private.settlement_processed_entries (
        processing_log_id, settlement_report_id, settlement_report_row_id, source_line_number,
        posted_date, posted_at, currency, settlement_amount, transaction_type, amount_type,
        amount_description, category_code, pnl_treatment, handling_method
    )
    select
        processing_id, report_id, report_row.id, report_row.source_line_number,
        '2026-09-01', '2026-09-01', 'USD', 0, 'Synthetic', 'Synthetic', 'Synthetic',
        'UNMAPPED', 'SKU_PNL', 'UNASSIGNED'
    from private.settlement_report_rows as report_row
    where report_row.settlement_report_id = report_id;
    insert into private.settlement_processed_results (
        processing_log_id, settlement_report_id, category_code, pnl_treatment,
        allocation_method, activity_start_date, activity_end_date, currency, settlement_amount
    )
    select
        processing_id, report_id, 'UNMAPPED', 'SKU_PNL', 'UNASSIGNED',
        '2026-09-01', '2026-09-01', 'USD', 0
    from generate_series(1, 2);
    set constraints all immediate;
    set constraints all deferred;
end;
$$;
