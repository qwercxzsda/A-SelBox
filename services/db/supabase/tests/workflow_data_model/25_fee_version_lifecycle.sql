-- A newer fee replaces only its company's entire former version, without erasing history.

insert into public.company_sku_fee_rates (
    id, seller_namespace, marketplace_id, sku, company_id,
    fee_rate_percent, valid_period, created_at
)
select
    fee_version.id::uuid,
    '__TEST__' as seller_namespace,
    'TEST_MARKETPLACE' as marketplace_id,
    'FEE-VERSION-SKU' as sku,
    fee_version.company_id::uuid,
    2.5 as fee_rate_percent,
    fee_version.valid_period::daterange,
    fee_version.created_at::timestamptz
from (
    values
    (
        '22000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '[2026-01-01,)', '2026-08-01 00:00:00+00'
    ),
    (
        '22000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000001',
        '[2026-05-01,2026-06-01)', '2026-08-03 00:00:00+00'
    ),
    (
        '22000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000002',
        '[2026-07-01,2026-08-01)', '2026-08-02 00:00:00+00'
    ),
    (
        '22000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000001',
        '[2026-01-01,)', '2026-08-02 00:00:00+00'
    ),
    (
        '22000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000001',
        '[2026-04-01,2026-05-01)', '2026-08-03 00:00:00+00'
    )
) as fee_version (id, company_id, valid_period, created_at)
order by fee_version.id;

do $$
begin
    if (
        select pg_catalog.array_agg(fee_rate.id order by fee_rate.company_id)
        from private.latest_company_sku_fee_rates as fee_rate
        where fee_rate.seller_namespace = '__TEST__'
          and fee_rate.marketplace_id = 'TEST_MARKETPLACE'
          and fee_rate.sku = 'FEE-VERSION-SKU'
    ) is distinct from array[
        '22000000-0000-0000-0000-000000000005'::uuid,
        '22000000-0000-0000-0000-000000000003'::uuid
    ] then
        raise exception 'Fee versions must select latest creation time and UUID separately per company.';
    end if;

    if exists (
        select 1
        from private.latest_company_sku_fee_rates as fee_rate
        where fee_rate.seller_namespace = '__TEST__'
          and fee_rate.marketplace_id = 'TEST_MARKETPLACE'
          and fee_rate.sku = 'FEE-VERSION-SKU'
          and fee_rate.valid_period @> '2026-02-01'::date
    ) or (
        select count(*)
        from public.company_sku_fee_rates as fee_rate
        where fee_rate.seller_namespace = '__TEST__'
          and fee_rate.marketplace_id = 'TEST_MARKETPLACE'
          and fee_rate.sku = 'FEE-VERSION-SKU'
    ) <> 5 then
        raise exception 'Superseded fee periods must remain stored without date-range fallback.';
    end if;

    begin
        insert into public.company_sku_fee_rates (
            seller_namespace, marketplace_id, sku, company_id,
            fee_rate_percent, valid_period, created_at
        )
        values (
            '__TEST__', 'TEST_MARKETPLACE', 'FEE-VERSION-SKU',
            '20000000-0000-0000-0000-000000000001', 3,
            daterange('2026-06-01', '2026-09-01', '[)'), '2026-08-04 00:00:00+00'
        );
        raise exception 'A new current fee must not overlap the other company.';
    exception
        when exclusion_violation then null;
    end;
end;
$$;
