"""Compare live authority and daily controls with independent real-source sums."""

import calendar
from datetime import date
from decimal import Decimal

from services.db.supabase.tests.verification.financial_reconciliation import raw_reconciliation
from services.db.supabase.tests.verification.financial_seed import Connection, as_user, require


def verify_authority(connection: Connection, operator: str) -> tuple[date, dict[str, object]]:
    today = connection.execute("select (now() at time zone 'UTC')::date").fetchall()[0][0]
    month_index = today.year * 12 + today.month - 1 - 2
    year, month_zero = divmod(month_index, 12)
    mature_cutoff_date = date(
        year, month_zero + 1, min(today.day, calendar.monthrange(year, month_zero + 1)[1])
    )
    policy = as_user(connection, operator, "select public.payout_report_policy()")[0][0]
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
            from private.settlement_transactions t
            join private.settlements h on h.current_version_id=t.version_id
            where t.posted_date < %s and t.category in ('SETTLEMENT','SELBOX')
            union all
            select t.currency,t.amount
            from private.data_kiosk_transactions t
            join private.data_kiosk_days h on h.current_version_id=t.version_id
            where t.amount <> 0 and (t.category='DATA_KIOSK' or
                (t.activity_date >= %s and t.category in ('SETTLEMENT','SELBOX')))
        ) select currency,sum(amount),count(*) from facts group by currency
        """,
        (mature_cutoff_date, mature_cutoff_date),
    ).fetchall()
    expected = {currency: [amount, count] for currency, amount, count in source_totals}
    difference_count = 0
    for row in raw_reconciliation(connection, mature_cutoff_date):
        if row[6] == 0 and row[7] == 0:
            continue
        values = expected.setdefault(row[3], [Decimal(0), 0])
        values[0] += row[8]
        values[1] += 1
        difference_count += 1
    minimum = connection.execute(
        "select least((select min(posted_date) from private.settlement_transactions),"
        "(select min(activity_date) from private.data_kiosk_transactions))"
    ).fetchall()[0][0]
    actual = as_user(
        connection, operator, "select public.transaction_totals(p_date_from => %s)", (minimum,)
    )[0][0]["rows"]
    require(
        expected
        == {
            row["currency"]: [Decimal(row["reported_amount"]), int(row["row_count"])]
            for row in actual
        },
        "Operator totals differ from mature Settlement/SelBox categories, Data Kiosk costs, "
        "daily differences, and recent Data Kiosk amounts",
    )
    excluded = connection.execute(
        "select count(*) from private.settlement_transactions t "
        "join private.settlements s on s.current_version_id=t.version_id "
        "where t.posted_date >= %s",
        (mature_cutoff_date,),
    ).fetchall()[0][0]
    return mature_cutoff_date, {
        "mature_cutoff_date": mature_cutoff_date.isoformat(),
        "latest_month": policy["latest_month"],
        "exact_currency_totals_match": True,
        "authoritative_row_count": sum(values[1] for values in expected.values()),
        "daily_difference_rows": difference_count,
        "recent_settlement_rows_excluded": excluded,
    }
