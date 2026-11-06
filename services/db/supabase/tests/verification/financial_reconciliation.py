"""Independent calculations over current and frozen financial source versions."""

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from services.db.supabase.tests.verification.financial_seed import Connection, require


def raw_reconciliation(
    connection: Connection, mature_cutoff_date: date, report_id: str | None = None
) -> list[tuple[Any, ...]]:
    """Sum original categories; never infer categories from SKU presence or another source."""
    rows = connection.execute(
        """
        select 'FINANCES',t.seller_namespace,v.posted_date,v.marketplace_name,v.currency,
            c.category,sum(c.amount)
        from private.finances_transaction_components c
        join private.finances_transaction_versions v on v.id=c.version_id
        join private.finances_transactions t on t.id=v.transaction_id
        where v.posted_date < %s and v.activity_eligible
          and c.category in ('FINANCES','SELBOX','DATA_KIOSK')
          and ((%s::uuid is null and t.current_version_id=v.id)
            or exists (select 1 from private.payout_report_finances_batches p
                join private.finances_preprocess_batch_transactions m on m.batch_id=p.batch_id
                join public.company_payout_reports r on r.id=p.report_id
                where p.report_id=%s and m.version_id=v.id
                    and v.marketplace_name is not distinct from r.marketplace_name
                    and v.currency=r.currency
                    and v.posted_date between r.start_date and r.end_date))
        group by t.seller_namespace,v.posted_date,v.marketplace_name,v.currency,c.category
        union all
        select 'DATA_KIOSK',d.seller_namespace,d.activity_date,d.marketplace_name,t.currency,
            t.category,sum(t.amount)
        from private.data_kiosk_day_components t
        join private.data_kiosk_day_versions v on v.id=t.version_id
        join private.data_kiosk_days d on d.id=v.day_id
        where d.activity_date < %s and t.category='DATA_KIOSK'
          and ((%s::uuid is null and d.current_version_id=t.version_id)
            or exists (select 1 from private.payout_report_data_kiosk_observations p
                join public.company_payout_reports r on r.id=p.report_id
                where p.report_id=%s and p.version_id=t.version_id
                    and d.marketplace_name is not distinct from r.marketplace_name
                    and t.currency=r.currency
                    and d.activity_date between r.start_date and r.end_date))
        group by d.seller_namespace,d.activity_date,d.marketplace_name,t.currency,t.category
        """,
        (mature_cutoff_date, report_id, report_id, mature_cutoff_date, report_id, report_id),
    ).fetchall()
    groups: dict[tuple[Any, ...], list[Decimal]] = defaultdict(lambda: [Decimal(0)] * 4)
    for source, seller, day, marketplace, currency, category, amount in rows:
        index = (
            3 if source == "DATA_KIOSK" else {"FINANCES": 0, "SELBOX": 1, "DATA_KIOSK": 2}[category]
        )
        groups[(seller, day, marketplace, currency)][index] += amount
    result: list[tuple[Any, ...]] = []
    for group, values in groups.items():
        (
            finances_category_amount,
            selbox_category_amount,
            data_kiosk_finances_control,
            data_kiosk_category_amount,
        ) = values
        difference = data_kiosk_finances_control - data_kiosk_category_amount
        finances_total = (
            finances_category_amount + selbox_category_amount + data_kiosk_finances_control
        )
        accounted_total = (
            finances_category_amount
            + selbox_category_amount
            + data_kiosk_category_amount
            + difference
        )
        result.append(
            (
                *group,
                finances_category_amount,
                selbox_category_amount,
                data_kiosk_finances_control,
                data_kiosk_category_amount,
                difference,
                finances_total,
                accounted_total,
            )
        )
    return result


def verify_live_reconciliation(
    connection: Connection, mature_cutoff_date: date
) -> dict[str, object]:
    expected = raw_reconciliation(connection, mature_cutoff_date)
    actual = connection.execute(
        "select seller_namespace,activity_date,marketplace_name,currency,"
        "finances_category_amount,selbox_category_amount,"
        "data_kiosk_finances_control,data_kiosk_category_amount,"
        "difference,finances_total,accounted_total from private.live_source_reconciliation"
    ).fetchall()
    require(
        set(actual) == set(expected), "Daily reconciliation differs from original category sums"
    )
    require(all(row[-2] == row[-1] for row in actual), "Daily finances equation does not balance")
    return {
        "daily_groups": len(actual),
        "null_marketplace_groups": sum(row[2] is None for row in expected),
        "finances_only_cost_groups": sum(row[6] != 0 and row[7] == 0 for row in expected),
        "kiosk_only_cost_groups": sum(row[6] == 0 and row[7] != 0 for row in expected),
        "independent_category_sums_match": True,
        "daily_equation_exact": True,
    }
