-- Fee rates and successful Settlement processing runs are append-only and versioned.

insert into public.companies (id, company_name)
values
('20000000-0000-0000-0000-000000000001', 'Test Company'),
('20000000-0000-0000-0000-000000000002', 'Other Test Company');

insert into public.company_sku_fee_rates (
    id,
    seller_namespace,
    marketplace_id,
    sku,
    company_id,
    fee_rate_percent,
    valid_period
)
values
(
    '21000000-0000-0000-0000-000000000001',
    '__TEST__',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    '20000000-0000-0000-0000-000000000001',
    2.5,
    daterange('2026-01-01', '2027-01-01', '[)')
),
(
    '21000000-0000-0000-0000-000000000002',
    '__TEST__',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    '20000000-0000-0000-0000-000000000001',
    3,
    daterange('2027-01-01', null, '[)')
),
(
    '21000000-0000-0000-0000-000000000003',
    '__TEST__',
    'TEST_MARKETPLACE',
    'ZERO-FEE-SKU',
    '20000000-0000-0000-0000-000000000001',
    0,
    daterange('2026-01-01', null, '[)')
),
(
    '21000000-0000-0000-0000-000000000004',
    '__TEST__',
    'TEST_MARKETPLACE',
    'HIGH-SCALE-SKU',
    '20000000-0000-0000-0000-000000000001',
    1e-6,
    daterange('2026-01-01', null, '[)')
);

do $$
declare
    invalid_rate numeric;
    rejected boolean;
begin
    foreach invalid_rate in array array[
        0.0000001, 2.5000001, 2.5000000, -0.000001, 100.000001,
        ('2.' || repeat('0', 2000))::numeric,
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    ] loop
        rejected := false;
        begin
            insert into public.company_sku_fee_rates (
                seller_namespace, marketplace_id, sku, company_id,
                fee_rate_percent, valid_period
            )
            values (
                '__TEST__', 'TEST_MARKETPLACE', 'INVALID-RATE-SKU',
                '20000000-0000-0000-0000-000000000001', invalid_rate,
                daterange('2026-01-01', null, '[)')
            );
        exception
            when check_violation then rejected := true;
        end;
        if not rejected then
            raise exception 'Fee-rate precision or business range was not enforced.';
        end if;
    end loop;

    if private.is_valid_fee_rate(0) is not true
       or private.is_valid_fee_rate(100) is not true
       or private.is_valid_fee_rate(0.000001) is not true
       or private.is_valid_fee_rate(2.500000) is not true
    then
        raise exception 'Valid fee-rate boundary values were rejected.';
    end if;
end;
$$;

do $$
declare
    overlap_rejected boolean := false;
    update_rejected boolean := false;
    delete_rejected boolean := false;
begin
    begin
        insert into public.company_sku_fee_rates (
            seller_namespace,
            marketplace_id,
            sku,
            company_id,
            fee_rate_percent,
            valid_period
        )
        values (
            '__TEST__',
            'TEST_MARKETPLACE',
            'TEST-SKU',
            '20000000-0000-0000-0000-000000000002',
            4,
            daterange('2026-06-01', '2027-06-01', '[)')
        );
    exception
        when exclusion_violation then
            overlap_rejected := true;
    end;

    begin
        update public.company_sku_fee_rates
        set fee_rate_percent = fee_rate_percent
        where id = '21000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            update_rejected := true;
    end;

    begin
        delete from public.company_sku_fee_rates
        where id = '21000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then
            delete_rejected := true;
    end;

    if not overlap_rejected or not update_rejected or not delete_rejected then
        raise exception 'Current company fee periods must not overlap; history must be append-only.';
    end if;
end;
$$;

do $$
declare
    truncate_rejected boolean := false;
begin
    begin
        truncate table private.settlement_processed_results;
    exception
        when raise_exception then
            truncate_rejected := true;
    end;

    if not truncate_rejected then
        raise exception 'Append-only processed tables must reject truncate.';
    end if;
end;
$$;

do $$
declare
    rejected boolean := false;
begin
    begin
        insert into private.settlement_processing_logs (
            id,
            settlement_report_id,
            processor_version,
            processed_at
        )
        values (
            '30000000-0000-0000-0000-000000000099',
            '10000000-0000-0000-0000-000000000001',
            'incomplete-test',
            '2026-09-03 00:00:00+00'
        );

        set constraints all immediate;
    exception
        when raise_exception then
            rejected := true;
    end;

    set constraints all deferred;

    if not rejected then
        raise exception 'Expected processing log without completed output rejection.';
    end if;
end;
$$;

insert into private.settlement_processing_logs (
    id,
    settlement_report_id,
    processor_version,
    processed_at
)
values
(
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'processor-v1',
    '2026-09-03 00:00:00+00'
),
(
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'processor-v2',
    '2026-09-03 00:00:00+00'
);

insert into private.settlement_processed_reports (
    processing_log_id,
    settlement_report_id,
    settlement_id,
    settlement_start_at,
    settlement_end_at,
    deposit_at,
    total_amount,
    currency,
    settlement_start_date,
    settlement_end_date,
    processed_entry_count,
    processed_result_count
)
values
(
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'SETTLEMENT-RAW-001',
    '2026-08-01 00:00:00+00',
    '2026-08-31 23:59:59+00',
    '2026-09-02 00:00:00+00',
    10.25,
    'USD',
    '2026-08-01',
    '2026-08-31',
    1,
    1
),
(
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'SETTLEMENT-RAW-001',
    '2026-08-01 00:00:00+00',
    '2026-08-31 23:59:59+00',
    '2026-09-02 00:00:00+00',
    10.25,
    'USD',
    '2026-08-01',
    '2026-08-31',
    1,
    1
);

insert into private.settlement_processed_entries (
    id,
    processing_log_id,
    settlement_report_id,
    settlement_report_row_id,
    source_line_number,
    posted_date,
    posted_at,
    currency,
    settlement_amount,
    transaction_type,
    amount_type,
    amount_description,
    category_code,
    pnl_treatment,
    handling_method,
    amazon_order_id,
    merchant_order_id,
    amazon_order_item_id,
    merchant_order_item_id,
    marketplace_name,
    marketplace_id,
    sku,
    quantity
)
values
(
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    9,
    '2026-08-15',
    '2026-08-15 12:00:00+00',
    'USD',
    10.25,
    'Order',
    'ItemPrice',
    'Principal',
    'PRODUCT_SALES',
    'SKU_PNL',
    'DIRECT_SKU',
    'ORDER-001',
    'MERCHANT-ORDER-001',
    'ORDER-ITEM-001',
    'MERCHANT-ITEM-001',
    'Test Marketplace',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    9223372036854775807
),
(
    '31000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    9,
    '2026-08-15',
    '2026-08-15 12:00:00+00',
    'USD',
    10.25,
    'Order',
    'ItemPrice',
    'Principal',
    'PRODUCT_SALES',
    'SKU_PNL',
    'DIRECT_SKU',
    'ORDER-001',
    'MERCHANT-ORDER-001',
    'ORDER-ITEM-001',
    'MERCHANT-ITEM-001',
    'Test Marketplace',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    9223372036854775807
);

insert into private.settlement_processed_results (
    id,
    processing_log_id,
    settlement_report_id,
    company_sku_fee_rate_id,
    company_id,
    marketplace_id,
    sku,
    category_code,
    pnl_treatment,
    allocation_method,
    activity_start_date,
    activity_end_date,
    currency,
    settlement_amount,
    elaborated_amount,
    selbox_fee_base,
    applied_fee_rate_percent,
    selbox_fee,
    settlement_quantity,
    elaborated_quantity,
    selbox_fee_base_quantity,
    selbox_fee_quantity,
    company_payable_quantity
)
values
(
    '32000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    'PRODUCT_SALES',
    'SKU_PNL',
    'DIRECT_SETTLEMENT',
    '2026-08-15',
    '2026-08-15',
    'USD',
    10.25,
    10.25,
    10.25,
    2.5,
    -0.25625,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807
),
(
    '32000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'TEST_MARKETPLACE',
    'TEST-SKU',
    'PRODUCT_SALES',
    'SKU_PNL',
    'DIRECT_SETTLEMENT',
    '2026-08-15',
    '2026-08-15',
    'USD',
    10.25,
    9.25,
    10.25,
    2.5,
    -0.25625,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807,
    9223372036854775807
);

do $$
declare
    exact_amount numeric;
    unit_count numeric;
begin
    select
        sum(processed_result.settlement_amount),
        case
            when count(*) = count(processed_result.settlement_quantity)
                then sum(processed_result.settlement_quantity)
        end
    into exact_amount, unit_count
    from private.latest_settlement_processed_results as processed_result
    where processed_result.settlement_report_id
        = '10000000-0000-0000-0000-000000000001'
      and processed_result.category_code = 'PRODUCT_SALES'
    group by
        processed_result.company_id,
        processed_result.marketplace_id,
        processed_result.sku,
        processed_result.currency;

    if exact_amount is distinct from 10.25 or unit_count is distinct from 9223372036854775807 then
        raise exception 'Category amount and quantity inputs must be queryable directly.';
    end if;
end;
$$;

do $$
declare
    bad_equation_rejected boolean := false;
    bad_period_rejected boolean := false;
begin
    begin
        insert into private.settlement_processed_results (
            processing_log_id,
            settlement_report_id,
            company_sku_fee_rate_id,
            company_id,
            marketplace_id,
            sku,
            category_code,
            pnl_treatment,
            allocation_method,
            activity_start_date,
            activity_end_date,
            currency,
            settlement_amount,
            elaborated_amount,
            selbox_fee_base,
            applied_fee_rate_percent,
            selbox_fee
        )
        values (
            '30000000-0000-0000-0000-000000000002',
            '10000000-0000-0000-0000-000000000001',
            '21000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            'TEST_MARKETPLACE',
            'TEST-SKU',
            'PRODUCT_SALES',
            'SKU_PNL',
            'DIRECT_SETTLEMENT',
            '2026-08-15',
            '2026-08-15',
            'USD',
            1,
            1,
            1,
            2.5,
            -0.20
        );
    exception
        when check_violation then
            bad_equation_rejected := true;
    end;

    begin
        insert into private.settlement_processed_results (
            processing_log_id,
            settlement_report_id,
            company_sku_fee_rate_id,
            company_id,
            marketplace_id,
            sku,
            category_code,
            pnl_treatment,
            allocation_method,
            activity_start_date,
            activity_end_date,
            currency,
            settlement_amount,
            elaborated_amount,
            selbox_fee_base,
            applied_fee_rate_percent,
            selbox_fee
        )
        values (
            '30000000-0000-0000-0000-000000000002',
            '10000000-0000-0000-0000-000000000001',
            '21000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            'TEST_MARKETPLACE',
            'TEST-SKU',
            'PRODUCT_SALES',
            'SKU_PNL',
            'DIRECT_SETTLEMENT',
            '2028-08-15',
            '2028-08-15',
            'USD',
            1,
            1,
            1,
            2.5,
            -0.025
        );
    exception
        when raise_exception then
            bad_period_rejected := true;
    end;

    if not bad_equation_rejected
       or not bad_period_rejected
    then
        raise exception 'Processed result fee controls did not reject invalid data.';
    end if;
end;
$$;

do $$
declare
    log_update_rejected boolean := false;
    report_update_rejected boolean := false;
    entry_update_rejected boolean := false;
    result_update_rejected boolean := false;
begin
    begin
        update private.settlement_processing_logs
        set processor_version = processor_version
        where id = '30000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then log_update_rejected := true;
    end;

    begin
        update private.settlement_processed_reports
        set total_amount = total_amount
        where processing_log_id = '30000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then report_update_rejected := true;
    end;

    begin
        update private.settlement_processed_entries
        set settlement_amount = settlement_amount
        where id = '31000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then entry_update_rejected := true;
    end;

    begin
        update private.settlement_processed_results
        set settlement_amount = settlement_amount
        where id = '32000000-0000-0000-0000-000000000001';
    exception
        when raise_exception then result_update_rejected := true;
    end;

    if not log_update_rejected
       or not report_update_rejected
       or not entry_update_rejected
       or not result_update_rejected
    then
        raise exception 'Successful Settlement processing output must be append-only.';
    end if;
end;
$$;

do $$
begin
    if (
        select latest_log.id
        from private.latest_settlement_processing_logs as latest_log
        where latest_log.settlement_report_id
            = '10000000-0000-0000-0000-000000000001'
    ) is distinct from '30000000-0000-0000-0000-000000000002'::uuid then
        raise exception 'Latest processing log did not use the deterministic UUID tie-break.';
    end if;

    if (
        select count(*)
        from private.latest_settlement_processed_results as latest_result
        where latest_result.id = '32000000-0000-0000-0000-000000000002'
          and latest_result.difference_amount = 1
          and latest_result.company_payable = 9.99375
    ) <> 1 then
        raise exception 'Latest processed results or generated equations are incorrect.';
    end if;
end;
$$;
