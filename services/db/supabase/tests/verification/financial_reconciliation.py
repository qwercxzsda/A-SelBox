"""Independent raw-source calculations for real-seed reconciliation verification."""

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from services.db.supabase.tests.verification.financial_seed import Connection, as_user, require


def raw_reconciliation(
    connection: Connection, mature_cutoff_date: date, report_id: str | None = None
) -> list[tuple[Any, ...]]:
    """Sum original categories; never infer categories from SKU presence or another source."""
    rows = connection.execute(
        """
        select 'SETTLEMENT',t.seller_namespace,t.posted_date,t.marketplace_name,t.currency,
            t.category,sum(t.amount)
        from private.settlement_transactions t
        where t.posted_date < %s and t.category in ('SETTLEMENT','SELBOX','DATA_KIOSK')
          and ((%s::uuid is null and exists (
              select 1 from private.settlements s where s.current_version_id=t.version_id))
            or exists (select 1 from private.payout_report_settlement_versions p
                join public.company_payout_reports r on r.id=p.report_id
                where p.report_id=%s and p.version_id=t.version_id
                    and t.posted_date between r.start_date and r.end_date))
        group by t.seller_namespace,t.posted_date,t.marketplace_name,t.currency,t.category
        union all
        select 'DATA_KIOSK',t.seller_namespace,t.activity_date,t.marketplace_name,t.currency,
            t.category,sum(t.amount)
        from private.data_kiosk_transactions t
        where t.activity_date < %s and t.category='DATA_KIOSK'
          and ((%s::uuid is null and exists (
              select 1 from private.data_kiosk_days d where d.current_version_id=t.version_id))
            or exists (select 1 from private.payout_report_data_kiosk_versions p
                join public.company_payout_reports r on r.id=p.report_id
                where p.report_id=%s and p.version_id=t.version_id
                    and t.activity_date between r.start_date and r.end_date))
        group by t.seller_namespace,t.activity_date,t.marketplace_name,t.currency,t.category
        """,
        (mature_cutoff_date, report_id, report_id, mature_cutoff_date, report_id, report_id),
    ).fetchall()
    groups: dict[tuple[Any, ...], list[Decimal]] = defaultdict(lambda: [Decimal(0)] * 4)
    for source, seller, day, marketplace, currency, category, amount in rows:
        index = (
            3
            if source == "DATA_KIOSK"
            else {"SETTLEMENT": 0, "SELBOX": 1, "DATA_KIOSK": 2}[category]
        )
        groups[(seller, day, marketplace, currency)][index] += amount
    result: list[tuple[Any, ...]] = []
    for group, values in groups.items():
        (
            settlement_category_amount,
            selbox_category_amount,
            data_kiosk_settlement_control,
            data_kiosk_category_amount,
        ) = values
        difference = data_kiosk_settlement_control - data_kiosk_category_amount
        settlement_total = (
            settlement_category_amount + selbox_category_amount + data_kiosk_settlement_control
        )
        accounted_total = (
            settlement_category_amount
            + selbox_category_amount
            + data_kiosk_category_amount
            + difference
        )
        result.append(
            (
                *group,
                settlement_category_amount,
                selbox_category_amount,
                data_kiosk_settlement_control,
                data_kiosk_category_amount,
                difference,
                settlement_total,
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
        "settlement_category_amount,selbox_category_amount,"
        "data_kiosk_settlement_control,data_kiosk_category_amount,"
        "difference,settlement_total,accounted_total from private.live_source_reconciliation"
    ).fetchall()
    require(
        set(actual) == set(expected), "Daily reconciliation differs from original category sums"
    )
    require(all(row[-2] == row[-1] for row in actual), "Daily settlement equation does not balance")
    return {
        "daily_groups": len(actual),
        "null_marketplace_groups": sum(row[2] is None for row in expected),
        "settlement_only_cost_groups": sum(row[6] != 0 and row[7] == 0 for row in expected),
        "kiosk_only_cost_groups": sum(row[6] == 0 and row[7] != 0 for row in expected),
        "independent_category_sums_match": True,
        "daily_equation_exact": True,
    }


def verify_frozen_reconciliation(
    connection: Connection, operator: str, reports: list[tuple[Any, ...]], mature_cutoff_date: date
) -> int:
    count = 0
    for report in reports:
        expected = raw_reconciliation(connection, mature_cutoff_date, str(report[0]))
        actual = as_user(
            connection,
            operator,
            "select seller_namespace,activity_date,marketplace_name,currency,"
            "settlement_category_amount,selbox_category_amount,"
            "data_kiosk_settlement_control,data_kiosk_category_amount,"
            "difference,settlement_total,accounted_total from public.payout_report_reconciliation "
            "where report_id=%s",
            (report[0],),
        )
        require(
            set(actual) == set(expected), "Frozen daily reconciliation differs from pinned inputs"
        )
        require(
            all(row[-2] == row[-1] for row in actual), "Frozen settlement equation does not balance"
        )
        count += len(actual)
    return count


def month_coverage(connection: Connection, month: date) -> dict[str, object]:
    """Count required covered days independently, including explicitly empty source days."""
    rows = connection.execute(
        """
        with markets as (
            select distinct seller_namespace,marketplace_name from private.data_kiosk_days
            where current_version_id is not null
        ), expected as (
            select m.*,day::date as activity_date from markets m
            cross join generate_series(%s::date,%s::date+interval '1 month - 1 day',
                                       interval '1 day') day
        ) select e.marketplace_name,count(*) as expected,
            count(*) filter (where v.id is null or p.version_id is not null) as missing
        from expected e
        left join private.data_kiosk_days d on d.seller_namespace=e.seller_namespace
            and d.marketplace_name=e.marketplace_name and d.activity_date=e.activity_date
            and d.dataset_key='economics'
        left join private.data_kiosk_preprocess_versions v on v.id=d.current_version_id
        left join private.data_kiosk_pruned_versions p on p.version_id=v.id
        group by e.marketplace_name order by e.marketplace_name
        """,
        (month, month),
    ).fetchall()
    return {
        "month": month.isoformat(),
        "marketplaces": len(rows),
        "expected_days": sum(row[1] for row in rows),
        "missing_days": sum(row[2] for row in rows),
    }
