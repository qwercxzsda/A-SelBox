-- Raw Settlement metadata and content are atomic, lossless, and immediately immutable.

do $$
declare
    rejected boolean := false;
begin
    begin
        insert into private.settlement_reports (
            id,
            seller_namespace,
            amazon_scope,
            amazon_report_id,
            amazon_document_id,
            amazon_report_created_at,
            marketplace_ids,
            marketplace_names,
            tsv_columns,
            metadata_values,
            metadata_source_line_number,
            decoded_content_sha256,
            content_row_count
        )
        values (
            '10000000-0000-0000-0000-000000000099',
            '__TEST__',
            'NA',
            'incomplete-report',
            'incomplete-document',
            '2026-09-01 00:00:00+00',
            array['TEST_MARKETPLACE'],
            array['Test Marketplace'],
            array['settlement-id', 'transaction-type', 'amount', 'sku'],
            array['INCOMPLETE', '', '', ''],
            2,
            repeat('9', 64),
            1
        );

        set constraints all immediate;
    exception
        when raise_exception then
            rejected := true;
    end;

    set constraints all deferred;

    if not rejected then
        raise exception 'Expected incomplete raw Settlement inventory rejection.';
    end if;
end;
$$;

do $$
declare
    rejected boolean := false;
begin
    begin
        insert into private.settlement_reports (
            seller_namespace,
            amazon_scope,
            amazon_report_id,
            amazon_document_id,
            amazon_report_created_at,
            marketplace_ids,
            marketplace_names,
            tsv_columns,
            metadata_values,
            metadata_source_line_number,
            decoded_content_sha256,
            content_row_count
        )
        values (
            '__TEST__',
            'NA',
            'wrong-metadata-width',
            'wrong-metadata-width-document',
            '2026-09-01 00:00:00+00',
            array['TEST_MARKETPLACE'],
            array['Test Marketplace'],
            array['settlement-id', 'transaction-type'],
            array['ONLY-ONE-VALUE'],
            2,
            repeat('8', 64),
            0
        );
    exception
        when check_violation then
            rejected := true;
    end;

    if not rejected then
        raise exception 'Expected raw Settlement metadata width rejection.';
    end if;
end;
$$;

-- Display names need not be unique, and noncanonical extra header text is raw data.
insert into private.settlement_reports (
    id,
    seller_namespace,
    amazon_scope,
    amazon_report_id,
    amazon_document_id,
    amazon_report_created_at,
    marketplace_ids,
    marketplace_names,
    tsv_columns,
    metadata_values,
    metadata_source_line_number,
    decoded_content_sha256,
    content_row_count
)
values (
    '10000000-0000-0000-0000-000000000098',
    '__TEST__',
    'NA',
    'LOSSLESS-HEADER-REPORT',
    'LOSSLESS-HEADER-DOCUMENT',
    '2026-09-01 00:00:00+00',
    array['TEST_MARKETPLACE_A', 'TEST_MARKETPLACE_B'],
    array['Shared Display Name', 'Shared Display Name'],
    array['settlement-id', ' extra-header '],
    array['LOSSLESS-HEADER', '  exact cell  '],
    2,
    repeat('8', 64),
    0
);

insert into private.settlement_reports (
    id,
    seller_namespace,
    amazon_scope,
    amazon_report_id,
    amazon_document_id,
    amazon_report_created_at,
    amazon_report_data_start_at,
    amazon_report_data_end_at,
    marketplace_ids,
    marketplace_names,
    tsv_columns,
    metadata_values,
    metadata_source_line_number,
    decoded_content_sha256,
    content_row_count
)
values (
    '10000000-0000-0000-0000-000000000001',
    '__TEST__',
    'NA',
    'RAW-REPORT-001',
    'RAW-DOCUMENT-001',
    '2026-09-01 00:00:00+00',
    '2026-08-01 00:00:00+00',
    '2026-08-31 23:59:59+00',
    array['TEST_MARKETPLACE'],
    array['Test Marketplace'],
    array['settlement-id', 'transaction-type', 'amount', 'sku'],
    array['  SETTLEMENT-RAW-001  ', '', '10,2500', ''],
    7,
    repeat('a', 64),
    1
);

insert into private.settlement_report_rows (
    id,
    settlement_report_id,
    source_line_number,
    column_values
)
values (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    9,
    array['SETTLEMENT-RAW-001', '  Order  ', '10,2500', 'TEST-SKU']
);

do $$
begin
    if (
        select private.is_current_transaction_xid(settlement_report.xmin)
        from private.settlement_reports as settlement_report
        where settlement_report.id = '10000000-0000-0000-0000-000000000001'
    ) is not true then
        raise exception 'A new report must belong to the current transaction.';
    end if;

    if (
        select private.is_current_transaction_xid(catalog_row.xmin)
        from pg_catalog.pg_class as catalog_row
        where catalog_row.oid = 'pg_catalog.pg_class'::regclass
    ) is not false then
        raise exception 'A committed parent must not pass the transaction guard.';
    end if;
end;
$$;

do $$
declare
    rejected boolean := false;
begin
    begin
        insert into private.settlement_report_rows (
            settlement_report_id,
            source_line_number,
            column_values
        )
        values (
            '10000000-0000-0000-0000-000000000001',
            10,
            array['SETTLEMENT-RAW-001', 'Order', '1']
        );
    exception
        when raise_exception then
            rejected := true;
    end;

    if not rejected then
        raise exception 'Expected raw Settlement row width rejection.';
    end if;
end;
$$;

do $$
declare
    rejected boolean := false;
begin
    begin
        insert into private.settlement_report_rows (
            settlement_report_id,
            source_line_number,
            column_values
        )
        values (
            '10000000-0000-0000-0000-000000000001',
            10,
            array['SETTLEMENT-RAW-001', null, '1', 'TEST-SKU']
        );
    exception
        when check_violation then
            rejected := true;
    end;

    if not rejected then
        raise exception 'Expected NULL raw Settlement cell rejection.';
    end if;
end;
$$;

do $$
declare
    duplicate_report_rejected boolean := false;
    duplicate_document_rejected boolean := false;
begin
    begin
        insert into private.settlement_reports (
            seller_namespace,
            amazon_scope,
            amazon_report_id,
            amazon_document_id,
            amazon_report_created_at,
            marketplace_ids,
            marketplace_names,
            tsv_columns,
            metadata_values,
            metadata_source_line_number,
            decoded_content_sha256,
            content_row_count
        )
        values (
            '__TEST__',
            'NA',
            'RAW-REPORT-001',
            'DIFFERENT-DOCUMENT',
            '2026-09-02 00:00:00+00',
            array['TEST_MARKETPLACE'],
            array['Test Marketplace'],
            array['settlement-id'],
            array['DUPLICATE'],
            1,
            repeat('b', 64),
            0
        );
    exception
        when unique_violation then
            duplicate_report_rejected := true;
    end;

    begin
        insert into private.settlement_reports (
            seller_namespace,
            amazon_scope,
            amazon_report_id,
            amazon_document_id,
            amazon_report_created_at,
            marketplace_ids,
            marketplace_names,
            tsv_columns,
            metadata_values,
            metadata_source_line_number,
            decoded_content_sha256,
            content_row_count
        )
        values (
            '__TEST__',
            'NA',
            'DIFFERENT-REPORT',
            'RAW-DOCUMENT-001',
            '2026-09-02 00:00:00+00',
            array['TEST_MARKETPLACE'],
            array['Test Marketplace'],
            array['settlement-id'],
            array['DUPLICATE'],
            1,
            repeat('c', 64),
            0
        );
    exception
        when unique_violation then
            duplicate_document_rejected := true;
    end;

    if not duplicate_report_rejected or not duplicate_document_rejected then
        raise exception 'Settlement report and document identities must be independent.';
    end if;
end;
$$;

do $$
declare
    row_update_rejected boolean := false;
    row_delete_rejected boolean := false;
    report_update_rejected boolean := false;
    report_delete_rejected boolean := false;
begin
    begin
        update private.settlement_report_rows
        set column_values = column_values
        where id = '11000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            row_update_rejected := true;
    end;

    begin
        delete from private.settlement_report_rows
        where id = '11000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            row_delete_rejected := true;
    end;

    begin
        update private.settlement_reports
        set amazon_report_id = amazon_report_id
        where id = '10000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            report_update_rejected := true;
    end;

    begin
        delete from private.settlement_reports
        where id = '10000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            report_delete_rejected := true;
    end;

    if not row_update_rejected
       or not row_delete_rejected
       or not report_update_rejected
       or not report_delete_rejected
    then
        raise exception 'Raw Settlement rows must reject every mutation immediately.';
    end if;

    if (
        select metadata_values
        from private.settlement_reports
        where id = '10000000-0000-0000-0000-000000000001'
    ) is distinct from array['  SETTLEMENT-RAW-001  ', '', '10,2500', ''] then
        raise exception 'Settlement metadata values were normalized.';
    end if;

    if (
        select column_values
        from private.settlement_report_rows
        where id = '11000000-0000-0000-0000-000000000001'
    ) is distinct from array['SETTLEMENT-RAW-001', '  Order  ', '10,2500', 'TEST-SKU'] then
        raise exception 'Settlement content values were normalized.';
    end if;
end;
$$;
