"""Compare live authority with independent sums over real source components."""

import calendar
from datetime import date
from decimal import Decimal

from services.db.supabase.tests.verification.financial_seed import Connection, as_user, require


def verify_authority(connection: Connection, administrator: str) -> tuple[date, dict[str, object]]:
    today = connection.execute("select (now() at time zone 'UTC')::date").fetchall()[0][0]
    month_index = today.year * 12 + today.month - 1 - 2
    year, month_zero = divmod(month_index, 12)
    mature_cutoff_date = date(
        year, month_zero + 1, min(today.day, calendar.monthrange(year, month_zero + 1)[1])
    )
    policy = as_user(connection, administrator, "select public.payout_report_policy()")[0][0]
    require(
        policy["mature_cutoff_date"] == mature_cutoff_date.isoformat(),
        "Policy does not use two calendar months",
    )
    require(
        policy["mature_cutoff_months"] == 2,
        "Mature cutoff period is not two months",
    )
    source_totals = connection.execute(
        """
        with facts as (
            select t.currency,t.amount
            from private.finances_component_details t
            where t.is_current and t.activity_eligible
                and t.category in ('FINANCES','SELBOX')
            union all
            select t.currency,t.amount
            from private.data_kiosk_day_components t
            join private.data_kiosk_days h on h.current_version_id=t.version_id
            where t.category='DATA_KIOSK'
        ) select currency,sum(amount),count(*) from facts group by currency
        """,
    ).fetchall()
    expected = {currency: [amount, count] for currency, amount, count in source_totals}
    minimum = connection.execute(
        "select least((select min(posted_date) from private.finances_transaction_versions),"
        "(select min(activity_date) from private.data_kiosk_days))"
    ).fetchall()[0][0]
    actual = as_user(
        connection, administrator, "select public.transaction_totals(p_date_from => %s)", (minimum,)
    )[0][0]["rows"]
    require(
        expected
        == {
            row["currency"]: [Decimal(row["reported_amount"]), int(row["row_count"])]
            for row in actual
        },
        "Administrator totals differ from eligible Finances/SelBox components and Data Kiosk costs",
    )
    excluded = connection.execute(
        "select count(*) from private.data_kiosk_day_components c "
        "join private.data_kiosk_days d on d.current_version_id=c.version_id "
        "where c.category<>'DATA_KIOSK'",
    ).fetchall()[0][0]
    return mature_cutoff_date, {
        "mature_cutoff_date": mature_cutoff_date.isoformat(),
        "latest_month": policy["latest_month"],
        "exact_currency_totals_match": True,
        "authoritative_row_count": sum(values[1] for values in expected.values()),
        "supporting_data_kiosk_rows_excluded": excluded,
    }
