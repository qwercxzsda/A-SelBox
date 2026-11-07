"""Independent arithmetic over immutable payout inputs in the current schema."""

from typing import Any

from services.db.supabase.tests.verification.financial_seed import Connection


def independent_payout_totals(connection: Connection, report_id: str) -> tuple[Any, ...]:
    """Recalculate source amounts and fees without using production resolver views."""
    return connection.execute(
        """
        with target as (
            select * from public.company_payout_reports where id=%s
        ), inputs as (
            select r.id as report_id,c.sku,v.marketplace_name,
                v.posted_date as day,v.currency,c.amount,c.fee_base
            from target r join private.payout_report_finances_versions p on p.report_id=r.id
            join private.finances_transaction_versions v on v.id=p.version_id
            join private.finances_transaction_components c on c.version_id=v.id
            where c.category='FINANCES' and v.activity_eligible
            union all
            select r.id,t.sku,d.marketplace_name,d.activity_date,
                t.currency,t.amount,t.fee_base
            from target r join private.payout_report_data_kiosk_versions p on p.report_id=r.id
            join private.data_kiosk_day_components t on t.version_id=p.version_id
            join private.data_kiosk_days d on d.id=p.day_id
            where t.category='DATA_KIOSK'
        ), assigned as (
            select t.amount,case when t.fee_base is null then 0
                else -t.fee_base*p.fee_rate_percent/100 end as fee
            from target r join inputs t on t.report_id=r.id
            join public.skus s on s.sku=t.sku
            join private.payout_report_terms_versions pin on pin.report_id=r.id and pin.sku_id=s.id
            join public.sku_terms_versions v on v.id=pin.terms_version_id
                and v.company_id=r.company_id
            left join public.sku_fee_periods p on p.terms_version_id=v.id
                and p.marketplace_name=t.marketplace_name and p.valid_period @> t.day
            where t.currency=r.currency
                and t.marketplace_name is not distinct from r.marketplace_name
                and t.day between r.start_date and r.end_date
        ) select coalesce(sum(amount),0),coalesce(sum(fee),0),coalesce(sum(amount+fee),0)
        from assigned
        """,
        (report_id,),
    ).fetchall()[0]
