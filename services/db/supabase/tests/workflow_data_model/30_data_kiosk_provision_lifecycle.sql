-- Successful provision batches retain history; latest views select each covered partition.

insert into private.data_kiosk_provision_processing_logs (
    id, seller_namespace, amazon_scope, marketplace_ids, processor_version,
    processed_at, provision_row_count
)
values (
    '30000000-0000-0000-0000-000000000001', '__TEST__', 'NA',
    array['TEST_MARKETPLACE', 'TEST_MARKETPLACE_OTHER'], 'test-v1',
    '2026-09-03 01:00:00+00', 4
);

insert into private.data_kiosk_provisions (
    processing_log_id,
    seller_namespace,
    amazon_scope,
    marketplace_id,
    activity_date,
    sku,
    currency,
    company_id,
    company_sku_fee_rate_id,
    child_asin,
    fnsku,
    parent_asin,
    units_sold,
    units_returned,
    net_units_sold,
    average_sales_price,
    product_sales,
    product_refunds,
    net_product_sales,
    amazon_fee_total,
    advertising_total,
    cost_of_goods_sold_per_unit,
    net_proceeds_total,
    fee_breakdown,
    ad_breakdown,
    selbox_fee_base,
    applied_fee_rate_percent,
    selbox_fee,
    refreshed_at
)
values (
    '30000000-0000-0000-0000-000000000001',
    '__TEST__',
    'NA',
    'TEST_MARKETPLACE',
    '2026-08-15',
    'TEST-SKU',
    'USD',
    '20000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'CHILD-ASIN',
    'FNSKU',
    'PARENT-ASIN',
    3,
    1,
    2,
    50,
    100,
    40,
    60,
    -15,
    -5,
    10,
    40,
    '[{"type":"FBA","amount":"-15"}]'::jsonb,
    '[{"type":"SPONSORED_PRODUCTS","amount":"-5"}]'::jsonb,
    100,
    2.5,
    -2.5,
    '2026-09-03 01:00:00+00'
),
(
    '30000000-0000-0000-0000-000000000001',
    '__TEST__',
    'NA',
    'TEST_MARKETPLACE',
    '2026-08-15',
    'ZERO-FEE-SKU',
    'USD',
    '20000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000003',
    null,
    null,
    'ZERO-FEE-PARENT',
    1,
    0,
    1,
    10,
    10,
    0,
    10,
    0,
    0,
    null,
    10,
    '[]'::jsonb,
    '[]'::jsonb,
    10,
    0,
    0,
    '2026-09-03 01:00:00+00'
),
(
    '30000000-0000-0000-0000-000000000001',
    '__TEST__',
    'NA',
    'TEST_MARKETPLACE',
    '2026-08-15',
    'HIGH-SCALE-SKU',
    'USD',
    '20000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000004',
    null,
    null,
    null,
    1,
    0,
    1,
    1e-1500,
    1e-1500,
    0,
    1e-1500,
    -1e-1600,
    0,
    1e-1600,
    1e-1500,
    '[]'::jsonb,
    '[]'::jsonb,
    1e-1500,
    1e-6,
    -1e-1508,
    '2026-09-03 01:00:00+00'
);

do $$
begin
    if (
        select
            high_scale_provision.selbox_fee
                <> -1e-1508
            or pg_catalog.min_scale(high_scale_provision.selbox_fee) <> 1508
            or high_scale_provision.product_sales_quantity <> 1
            or high_scale_provision.product_refunds_quantity <> 0
            or high_scale_provision.net_product_sales_quantity <> 1
            or high_scale_provision.selbox_fee_base_quantity <> 1
            or high_scale_provision.selbox_fee_quantity <> 1
            or high_scale_provision.amazon_fee_total_quantity is not null
            or high_scale_provision.advertising_total_quantity is not null
            or high_scale_provision.net_proceeds_total_quantity is not null
            or high_scale_provision.net_product_sales
                <> high_scale_provision.product_sales
                    - high_scale_provision.product_refunds
        from private.data_kiosk_provisions as high_scale_provision
        where high_scale_provision.seller_namespace = '__TEST__'
          and high_scale_provision.amazon_scope = 'NA'
          and high_scale_provision.marketplace_id = 'TEST_MARKETPLACE'
          and high_scale_provision.activity_date = '2026-08-15'
          and high_scale_provision.sku = 'HIGH-SCALE-SKU'
          and high_scale_provision.currency = 'USD'
    ) is not false then
        raise exception 'Data Kiosk provision amounts lost arbitrary numeric scale.';
    end if;
end;
$$;

create function pg_temp.insert_test_provision(
    p_processing_log_id uuid,
    p_marketplace_id text,
    p_sku text
)
returns void
language sql
as $$
    insert into private.data_kiosk_provisions (
        processing_log_id, seller_namespace, amazon_scope, marketplace_id,
        activity_date, sku, currency, units_sold, units_returned, net_units_sold,
        product_sales, product_refunds, net_product_sales, amazon_fee_total,
        advertising_total, selbox_fee_base, selbox_fee, refreshed_at
    )
    select
        processing_log.id, processing_log.seller_namespace, processing_log.amazon_scope,
        p_marketplace_id, '2026-08-15', p_sku, 'USD', 1, 0, 1,
        12, 0, 12, -2, 0, 12, 0, processing_log.processed_at
    from private.data_kiosk_provision_processing_logs as processing_log
    where processing_log.id = p_processing_log_id;
$$;

select pg_temp.insert_test_provision(
    '30000000-0000-0000-0000-000000000001', 'TEST_MARKETPLACE_OTHER', 'OTHER-SKU'
);

do $$
declare
    bad_equation_rejected boolean := false;
    refund_fee_base_rejected boolean := false;
    bad_period_rejected boolean := false;
    rounded_fee_rejected boolean := false;
begin
    begin
        insert into private.data_kiosk_provisions (
            processing_log_id,
            seller_namespace,
            amazon_scope,
            marketplace_id,
            activity_date,
            sku,
            currency,
            units_sold,
            units_returned,
            net_units_sold,
            product_sales,
            product_refunds,
            net_product_sales,
            amazon_fee_total,
            advertising_total,
            selbox_fee_base,
            selbox_fee,
            refreshed_at
        )
        values (
            '30000000-0000-0000-0000-000000000001',
            '__TEST__',
            'NA',
            'TEST_MARKETPLACE',
            '2026-08-16',
            'BAD-UNIT-SKU',
            'USD',
            3,
            1,
            3,
            10,
            2,
            8,
            0,
            0,
            10,
            0,
            '2026-09-03 01:00:00+00'
        );
    exception
        when check_violation then
            bad_equation_rejected := true;
    end;

    begin
        insert into private.data_kiosk_provisions (
            processing_log_id,
            seller_namespace,
            amazon_scope,
            marketplace_id,
            activity_date,
            sku,
            currency,
            units_sold,
            units_returned,
            net_units_sold,
            product_sales,
            product_refunds,
            net_product_sales,
            amazon_fee_total,
            advertising_total,
            selbox_fee_base,
            selbox_fee,
            refreshed_at
        )
        values (
            '30000000-0000-0000-0000-000000000001',
            '__TEST__',
            'NA',
            'TEST_MARKETPLACE',
            '2026-08-16',
            'REFUND-BASE-SKU',
            'USD',
            1,
            0,
            1,
            10,
            2,
            8,
            0,
            0,
            8,
            0,
            '2026-09-03 01:00:00+00'
        );
    exception
        when check_violation then
            refund_fee_base_rejected := true;
    end;

    begin
        insert into private.data_kiosk_provisions (
            processing_log_id,
            seller_namespace,
            amazon_scope,
            marketplace_id,
            activity_date,
            sku,
            currency,
            company_id,
            company_sku_fee_rate_id,
            units_sold,
            units_returned,
            net_units_sold,
            product_sales,
            product_refunds,
            net_product_sales,
            amazon_fee_total,
            advertising_total,
            selbox_fee_base,
            applied_fee_rate_percent,
            selbox_fee,
            refreshed_at
        )
        values (
            '30000000-0000-0000-0000-000000000001',
            '__TEST__',
            'NA',
            'TEST_MARKETPLACE',
            '2028-08-16',
            'TEST-SKU',
            'USD',
            '20000000-0000-0000-0000-000000000001',
            '21000000-0000-0000-0000-000000000001',
            1,
            0,
            1,
            10,
            0,
            10,
            0,
            0,
            10,
            2.5,
            -0.25,
            '2028-09-03 01:00:00+00'
        );
    exception
        when raise_exception then
            bad_period_rejected := true;
    end;

    begin
        insert into private.data_kiosk_provisions (
            processing_log_id,
            seller_namespace,
            amazon_scope,
            marketplace_id,
            activity_date,
            sku,
            currency,
            company_id,
            company_sku_fee_rate_id,
            units_sold,
            units_returned,
            net_units_sold,
            product_sales,
            product_refunds,
            net_product_sales,
            amazon_fee_total,
            advertising_total,
            selbox_fee_base,
            applied_fee_rate_percent,
            selbox_fee,
            refreshed_at
        )
        values (
            '30000000-0000-0000-0000-000000000001',
            '__TEST__',
            'NA',
            'TEST_MARKETPLACE',
            '2026-08-16',
            'HIGH-SCALE-SKU',
            'USD',
            '20000000-0000-0000-0000-000000000001',
            '21000000-0000-0000-0000-000000000004',
            1,
            0,
            1,
            1e-1501,
            0,
            1e-1501,
            0,
            0,
            1e-1501,
            1e-6,
            0,
            '2026-09-03 01:00:00+00'
        );
    exception
        when check_violation then
            rounded_fee_rejected := true;
    end;

    if not bad_equation_rejected
       or not refund_fee_base_rejected
       or not bad_period_rejected
       or not rounded_fee_rejected
    then
        raise exception 'Provision equations or effective fee period were not enforced.';
    end if;
end;
$$;

-- A second batch can contain the same natural key without changing the older facts.
insert into private.data_kiosk_provision_processing_logs (
    id, seller_namespace, amazon_scope, marketplace_ids, processor_version,
    processed_at, provision_row_count
)
values (
    '30000000-0000-0000-0000-000000000002', '__TEST__', 'NA',
    array['TEST_MARKETPLACE'], 'test-v2', '2026-09-04 01:00:00+00', 1
);

select pg_temp.insert_test_provision(
    '30000000-0000-0000-0000-000000000002', 'TEST_MARKETPLACE', 'TEST-SKU'
);

do $$
declare
    duplicate_rejected boolean := false;
    uncovered_marketplace_rejected boolean := false;
    mutation_statement text;
    mutation_rejected boolean;
begin
    if (
        select count(*)
        from private.data_kiosk_provisions
        where seller_namespace = '__TEST__' and amazon_scope = 'NA'
    ) <> 5 or (
        select count(*)
        from private.latest_data_kiosk_provisions
        where seller_namespace = '__TEST__' and amazon_scope = 'NA'
    ) <> 2 or not exists (
        select 1
        from private.latest_data_kiosk_provisions
        where processing_log_id = '30000000-0000-0000-0000-000000000001'
          and marketplace_id = 'TEST_MARKETPLACE_OTHER'
    ) or not exists (
        select 1
        from private.latest_data_kiosk_provisions
        where processing_log_id = '30000000-0000-0000-0000-000000000002'
          and sku = 'TEST-SKU' and product_sales = 12
    ) then
        raise exception 'Latest provisions mixed batches or lost an untouched marketplace.';
    end if;

    begin
        perform pg_temp.insert_test_provision(
            '30000000-0000-0000-0000-000000000002', 'TEST_MARKETPLACE', 'TEST-SKU'
        );
    exception when unique_violation then
        duplicate_rejected := true;
    end;

    begin
        perform pg_temp.insert_test_provision(
            '30000000-0000-0000-0000-000000000002', 'TEST_MARKETPLACE_OTHER', 'TEST-SKU'
        );
    exception when raise_exception then
        uncovered_marketplace_rejected := true;
    end;

    if not duplicate_rejected or not uncovered_marketplace_rejected then
        raise exception 'Provision uniqueness or processing-log coverage was not enforced.';
    end if;

    foreach mutation_statement in array array[
        'update private.data_kiosk_provisions set amazon_fee_total = -14 '
            || 'where processing_log_id = ''30000000-0000-0000-0000-000000000002''',
        'update private.data_kiosk_provision_processing_logs set processor_version = ''changed'' '
            || 'where id = ''30000000-0000-0000-0000-000000000002''',
        'delete from private.data_kiosk_provision_processing_logs '
            || 'where id = ''30000000-0000-0000-0000-000000000002''',
        'truncate private.data_kiosk_provision_processing_logs cascade'
    ] loop
        mutation_rejected := false;
        begin
            execute mutation_statement;
        exception when raise_exception then
            mutation_rejected := true;
        end;
        if not mutation_rejected then
            raise exception 'An immutable provision mutation was accepted: %', mutation_statement;
        end if;
    end loop;
end;
$$;

-- Identical processed_at values use the UUID tie-breaker, even for empty results.
insert into private.data_kiosk_provision_processing_logs (
    id, seller_namespace, amazon_scope, marketplace_ids, processor_version,
    processed_at, provision_row_count
)
values (
    '30000000-0000-0000-0000-000000000003', '__TEST__', 'NA',
    array['TEST_MARKETPLACE'], 'test-empty', '2026-09-04 01:00:00+00', 0
),
(
    '30000000-0000-0000-0000-000000000005', '__TEST_PROVISION_OTHER__', 'NA',
    array['TEST_MARKETPLACE'], 'test-other-seller', '2026-09-01 01:00:00+00', 1
),
(
    '30000000-0000-0000-0000-000000000006', '__TEST__', 'EU',
    array['TEST_MARKETPLACE'], 'test-other-scope', '2026-09-01 01:00:00+00', 1
);

select pg_temp.insert_test_provision(
    '30000000-0000-0000-0000-000000000005', 'TEST_MARKETPLACE', 'TEST-SKU'
);

select pg_temp.insert_test_provision(
    '30000000-0000-0000-0000-000000000006', 'TEST_MARKETPLACE', 'TEST-SKU'
);

do $$
declare
    failed_batch_rolled_back boolean := false;
    invalid_arguments record;
    invalid_arguments_rejected boolean;
begin
    if exists (
        select 1
        from private.latest_data_kiosk_provisions
        where seller_namespace = '__TEST__' and amazon_scope = 'NA'
          and marketplace_id = 'TEST_MARKETPLACE'
    ) or not exists (
        select 1
        from private.latest_data_kiosk_provision_processing_logs
        where id = '30000000-0000-0000-0000-000000000003'
          and marketplace_id = 'TEST_MARKETPLACE' and provision_row_count = 0
    ) then
        raise exception 'An empty successful batch must supersede older provision results.';
    end if;

    begin
        insert into private.data_kiosk_provision_processing_logs (
            id, seller_namespace, amazon_scope, marketplace_ids, processor_version,
            processed_at, provision_row_count
        ) values (
            '30000000-0000-0000-0000-000000000004', '__TEST__', 'NA',
            array['TEST_MARKETPLACE'], 'test-failed', '2026-09-05 01:00:00+00', 2
        );
        perform pg_temp.insert_test_provision(
            '30000000-0000-0000-0000-000000000004', 'TEST_MARKETPLACE', 'TEST-SKU'
        );
        perform pg_temp.insert_test_provision(
            '30000000-0000-0000-0000-000000000004', 'TEST_MARKETPLACE', 'TEST-SKU'
        );
    exception when unique_violation then
        failed_batch_rolled_back := true;
    end;

    if not failed_batch_rolled_back or exists (
        select 1 from private.data_kiosk_provision_processing_logs
        where id = '30000000-0000-0000-0000-000000000004'
    ) or exists (
        select 1 from private.data_kiosk_provisions
        where processing_log_id = '30000000-0000-0000-0000-000000000004'
    ) then
        raise exception 'A failed provision batch left its log or partial results behind.';
    end if;

    for invalid_arguments in
        select * from (values
            ('__TEST__'::text, 'NA'::text, 0),
            ('__TEST__', 'NA', -1),
            ('__TEST__', 'NA', null),
            (null, 'NA', 1),
            ('', 'NA', 1),
            (' __TEST__', 'NA', 1),
            ('__TEST__', null, 1),
            ('__TEST__', 'INVALID', 1)
        ) as invalid_input (seller_namespace, amazon_scope, keep_latest)
    loop
        invalid_arguments_rejected := false;
        begin
            perform private.prune_data_kiosk_provision_results(
                invalid_arguments.seller_namespace, invalid_arguments.amazon_scope,
                invalid_arguments.keep_latest
            );
        exception when invalid_parameter_value then
            invalid_arguments_rejected := true;
        end;
        if not invalid_arguments_rejected then
            raise exception 'Invalid provision retention arguments were accepted.';
        end if;
    end loop;

    if private.prune_data_kiosk_provision_results('__TEST__', 'NA', 2) is distinct from 3 then
        raise exception 'Provision pruning did not retain exactly the requested batch history.';
    end if;
    if private.prune_data_kiosk_provision_results('__TEST__', 'NA', 2) is distinct from 0 then
        raise exception 'Repeated provision pruning must leave already retained history intact.';
    end if;
    if private.prune_data_kiosk_provision_results('__TEST__', 'NA', 1) is distinct from 1 then
        raise exception 'An empty latest batch must allow pruning the previous batch results.';
    end if;

    if (
        select count(*) from private.data_kiosk_provisions
        where seller_namespace = '__TEST__' and amazon_scope = 'NA'
    ) <> 1 or not exists (
        select 1 from private.latest_data_kiosk_provisions
        where processing_log_id = '30000000-0000-0000-0000-000000000001'
          and marketplace_id = 'TEST_MARKETPLACE_OTHER'
    ) or (
        select count(*) from private.data_kiosk_provisions
        where processing_log_id in (
            '30000000-0000-0000-0000-000000000005',
            '30000000-0000-0000-0000-000000000006'
        )
    ) <> 2 or (
        select count(*) from private.data_kiosk_provision_processing_logs
        where seller_namespace = '__TEST__' and amazon_scope = 'NA'
    ) <> 3 or not exists (
        select 1 from private.data_kiosk_provision_processing_logs
        where id = '30000000-0000-0000-0000-000000000001'
          and provision_row_count = 4
    ) then
        raise exception 'Pruning removed logs, audit counts, or another partition current results.';
    end if;
end;
$$;
