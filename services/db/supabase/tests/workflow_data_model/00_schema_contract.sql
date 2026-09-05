-- The database contains only the persistence boundaries required by the three workflows.

do $$
begin
    if exists (
        select 1
        from information_schema.tables as private_table
        where private_table.table_schema = 'private'
          and private_table.table_type = 'BASE TABLE'
          and private_table.table_name not in (
              'settlement_reports',
              'settlement_report_rows',
              'settlement_processing_logs',
              'settlement_processed_reports',
              'settlement_processed_entries',
              'settlement_processed_results',
              'data_kiosk_provisions',
              'data_kiosk_provision_processing_logs'
          )
    ) then
        raise exception 'The private schema contains an unsupported persistence table.';
    end if;

    if exists (
        select required_relation.relation_name
        from (
            values
                ('public.companies'),
                ('public.company_sku_fee_rates'),
                ('private.latest_company_sku_fee_rates'),
                ('private.settlement_reports'),
                ('private.settlement_report_rows'),
                ('private.settlement_processing_logs'),
                ('private.settlement_processed_reports'),
                ('private.settlement_processed_entries'),
                ('private.settlement_processed_results'),
                ('private.data_kiosk_provisions'),
                ('private.data_kiosk_provision_processing_logs'),
                ('private.latest_data_kiosk_provision_processing_logs'),
                ('private.latest_data_kiosk_provisions'),
                ('private.latest_settlement_processing_logs'),
                ('private.latest_settlement_processed_results')
        ) as required_relation (relation_name)
        where pg_catalog.to_regclass(required_relation.relation_name) is null
    ) then
        raise exception 'A required workflow relation is missing.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        where not trigger_record.tgisinternal
          and trigger_record.tgname in (
              'enforce_settlement_report_row_width',
              'enforce_processed_report_same_transaction',
              'enforce_processed_entry_same_transaction',
              'enforce_processed_result_same_transaction',
              'enforce_provision_processing_log',
              'enforce_current_company_sku_fee_period'
          )
    ) <> 6 then
        raise exception 'Workflow tables are missing required insert guards.';
    end if;

    if exists (
        select 1
        from (values
            ('enforce_settlement_report_row_content_count', 'private.settlement_report_rows'),
            ('enforce_settlement_processed_report_inventory', 'private.settlement_processed_reports'),
            ('enforce_settlement_processed_entry_inventory', 'private.settlement_processed_entries'),
            ('enforce_settlement_processed_result_inventory', 'private.settlement_processed_results')
        ) as expected_trigger (trigger_name, relation_name)
        left join pg_catalog.pg_trigger as actual_trigger
            on actual_trigger.tgname = expected_trigger.trigger_name
           and actual_trigger.tgrelid = expected_trigger.relation_name::regclass
           and not actual_trigger.tgisinternal
        where actual_trigger.oid is null
           or not actual_trigger.tgdeferrable
           or not actual_trigger.tginitdeferred
           or actual_trigger.tgtype <> 5
    ) then
        raise exception 'Inventory child checks must be deferred AFTER INSERT row triggers.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        where not trigger_record.tgisinternal
          and trigger_record.tgname in (
              'reject_company_sku_fee_rate_truncate',
              'reject_settlement_report_truncate',
              'reject_settlement_report_row_truncate',
              'reject_settlement_processing_log_truncate',
              'reject_settlement_processed_report_truncate',
              'reject_settlement_processed_entry_truncate',
              'reject_settlement_processed_result_truncate',
              'reject_data_kiosk_provision_processing_log_truncate'
          )
    ) <> 8 then
        raise exception 'Append-only tables are missing truncate guards.';
    end if;

    if exists (
        select required_column.column_name
        from (
            values
                ('amazon_report_created_at'),
                ('amazon_report_data_start_at'),
                ('amazon_report_data_end_at'),
                ('tsv_columns'),
                ('metadata_source_line_number'),
                ('metadata_values'),
                ('decoded_content_sha256'),
                ('content_row_count'),
                ('inserted_at')
        ) as required_column (column_name)
        left join information_schema.columns as actual_column
            on actual_column.table_schema = 'private'
           and actual_column.table_name = 'settlement_reports'
           and actual_column.column_name = required_column.column_name
        where actual_column.column_name is null
    ) then
        raise exception 'Settlement report source columns do not match the contract.';
    end if;

    if exists (
        select required_column.column_name
        from (
            values
                ('id'),
                ('settlement_report_id'),
                ('source_line_number'),
                ('column_values')
        ) as required_column (column_name)
        left join information_schema.columns as actual_column
            on actual_column.table_schema = 'private'
           and actual_column.table_name = 'settlement_report_rows'
           and actual_column.column_name = required_column.column_name
        where actual_column.column_name is null
    ) then
        raise exception 'Settlement raw-row columns do not match the contract.';
    end if;

    if exists (
        select
            required_numeric.relation_name,
            required_numeric.column_name
        from (
            values
                ('public.company_sku_fee_rates', 'fee_rate_percent'),
                ('private.settlement_processed_reports', 'total_amount'),
                ('private.settlement_processed_entries', 'settlement_amount'),
                ('private.settlement_processed_results', 'settlement_amount'),
                ('private.settlement_processed_results', 'elaborated_amount'),
                ('private.settlement_processed_results', 'difference_amount'),
                ('private.settlement_processed_results', 'selbox_fee_base'),
                ('private.settlement_processed_results', 'applied_fee_rate_percent'),
                ('private.settlement_processed_results', 'settlement_quantity'),
                ('private.settlement_processed_results', 'elaborated_quantity'),
                ('private.settlement_processed_results', 'difference_quantity'),
                ('private.settlement_processed_results', 'selbox_fee_base_quantity'),
                ('private.settlement_processed_results', 'selbox_fee_quantity'),
                ('private.settlement_processed_results', 'company_payable_quantity'),
                ('private.settlement_processed_results', 'selbox_fee'),
                ('private.settlement_processed_results', 'company_payable'),
                ('private.data_kiosk_provisions', 'units_sold'),
                ('private.data_kiosk_provisions', 'units_returned'),
                ('private.data_kiosk_provisions', 'net_units_sold'),
                ('private.data_kiosk_provisions', 'average_sales_price'),
                ('private.data_kiosk_provisions', 'product_sales'),
                ('private.data_kiosk_provisions', 'product_refunds'),
                ('private.data_kiosk_provisions', 'net_product_sales'),
                ('private.data_kiosk_provisions', 'amazon_fee_total'),
                ('private.data_kiosk_provisions', 'advertising_total'),
                ('private.data_kiosk_provisions', 'cost_of_goods_sold_per_unit'),
                ('private.data_kiosk_provisions', 'shipping_to_amazon_cost_per_unit'),
                ('private.data_kiosk_provisions', 'mfn_fulfillment_cost_per_unit'),
                ('private.data_kiosk_provisions', 'mfn_storage_cost_per_unit'),
                ('private.data_kiosk_provisions', 'miscellaneous_cost_per_unit'),
                ('private.data_kiosk_provisions', 'net_proceeds_per_unit'),
                ('private.data_kiosk_provisions', 'net_proceeds_total'),
                ('private.data_kiosk_provisions', 'selbox_fee_base'),
                ('private.data_kiosk_provisions', 'applied_fee_rate_percent'),
                ('private.data_kiosk_provisions', 'product_sales_quantity'),
                ('private.data_kiosk_provisions', 'product_refunds_quantity'),
                ('private.data_kiosk_provisions', 'net_product_sales_quantity'),
                ('private.data_kiosk_provisions', 'selbox_fee_base_quantity'),
                ('private.data_kiosk_provisions', 'selbox_fee_quantity'),
                ('private.data_kiosk_provisions', 'amazon_fee_total_quantity'),
                ('private.data_kiosk_provisions', 'advertising_total_quantity'),
                ('private.data_kiosk_provisions', 'net_proceeds_total_quantity'),
                ('private.data_kiosk_provisions', 'selbox_fee')
        ) as required_numeric (relation_name, column_name)
        left join pg_catalog.pg_attribute as actual_column
            on actual_column.attrelid = required_numeric.relation_name::regclass
           and actual_column.attname = required_numeric.column_name
           and actual_column.attnum > 0
           and not actual_column.attisdropped
        where actual_column.attnum is null
           or actual_column.atttypid <> 'pg_catalog.numeric'::regtype
           or actual_column.atttypmod <> -1
    ) then
        raise exception 'Workflow numeric columns must be unconstrained numeric.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_constraint as foreign_key
        where foreign_key.contype = 'f'
          and foreign_key.confrelid
            = 'private.settlement_processing_logs'::regclass
          and foreign_key.conrelid = any(array[
              'private.settlement_processed_reports'::regclass,
              'private.settlement_processed_entries'::regclass,
              'private.settlement_processed_results'::regclass
          ])
    ) <> 3 then
        raise exception 'Every processed child must directly reference its processing log.';
    end if;

    if exists (
        select 1
        from information_schema.columns as provision_column
        where provision_column.table_schema = 'private'
          and provision_column.table_name = 'data_kiosk_provisions'
          and (
              provision_column.column_name like '%source%'
              or provision_column.column_name like '%request%'
              or provision_column.column_name like '%document%'
              or provision_column.column_name like '%revision%'
              or provision_column.column_name like '%publication%'
              or provision_column.column_name like '%batch%'
          )
    ) then
        raise exception 'Provisions must not retain transient Amazon source identity.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        where trigger_record.tgname like 'reject_%_mutation'
          and not trigger_record.tgisinternal
    ) <> 8 then
        raise exception 'Append-only workflow tables are missing mutation guards.';
    end if;

    if exists (
        select required_table.relation_name
        from (
            values
                ('public.companies'),
                ('public.company_sku_fee_rates'),
                ('private.settlement_reports'),
                ('private.settlement_report_rows'),
                ('private.settlement_processing_logs'),
                ('private.settlement_processed_reports'),
                ('private.settlement_processed_entries'),
                ('private.settlement_processed_results'),
                ('private.data_kiosk_provisions'),
                ('private.data_kiosk_provision_processing_logs')
        ) as required_table (relation_name)
        inner join pg_catalog.pg_class as table_record
            on table_record.oid = required_table.relation_name::regclass
        where not table_record.relrowsecurity
    ) then
        raise exception 'Every workflow table must have row-level security enabled.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_class as view_record
        where view_record.oid = any(array[
            'private.latest_settlement_processing_logs'::regclass,
            'private.latest_settlement_processed_results'::regclass,
            'private.latest_company_sku_fee_rates'::regclass,
            'private.latest_data_kiosk_provision_processing_logs'::regclass,
            'private.latest_data_kiosk_provisions'::regclass
        ])
          and not coalesce('security_invoker=true' = any(view_record.reloptions), false)
    ) then
        raise exception 'Current workflow views must use invoker security.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_constraint as foreign_key
        where foreign_key.contype = 'f'
          and foreign_key.conrelid = 'private.data_kiosk_provisions'::regclass
          and foreign_key.confrelid
            = 'private.data_kiosk_provision_processing_logs'::regclass
    ) or not exists (
        select 1
        from pg_catalog.pg_attribute as primary_key_column
        inner join pg_catalog.pg_constraint as primary_key
            on primary_key.conrelid = primary_key_column.attrelid
           and primary_key.conkey = array[primary_key_column.attnum]
           and primary_key.contype = 'p'
        where primary_key_column.attrelid = 'private.data_kiosk_provisions'::regclass
          and primary_key_column.attname = 'id'
          and primary_key_column.atttypid = 'pg_catalog.uuid'::regtype
    ) then
        raise exception 'Provisions require a UUID primary key and processing-log foreign key.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_proc as pruning_function
        where pruning_function.oid =
            'private.prune_data_kiosk_provision_results(text,text,integer)'::regprocedure
          and not pruning_function.prosecdef
          and pruning_function.prorettype = 'pg_catalog.int8'::regtype
          and 'search_path=""' = any(pruning_function.proconfig)
    ) then
        raise exception 'Provision pruning must use invoker privileges and an empty search path.';
    end if;
end;
$$;
