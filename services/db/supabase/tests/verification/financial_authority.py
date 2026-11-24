"""Compare live authority with independent sums over real source components."""

import calendar
from datetime import date

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
    mismatches = as_user(
        connection,
        administrator,
        """
        with native as (select seller_namespace,amazon_scope,marketplace_name,currency,
            date_trunc('month',posted_date)::date as month,
            sum(case when amount_part='TAX' then 0 else amount end) as base,
            sum(case when amount_part='TAX' then amount else 0 end) as tax
            from private.finances_component_details
            where is_current and activity_eligible group by 1,2,3,4,5),
        results as (select seller_namespace,amazon_scope,marketplace_name,currency,month,
            sum(company_base+selbox_base+difference_base) as base,
            sum(company_tax+selbox_tax+difference_tax) as tax
            from public.financial_review_monthly group by 1,2,3,4,5)
        select count(*) from native full join results
            using(seller_namespace,amazon_scope,marketplace_name,currency,month)
        where coalesce(native.base,0)<>coalesce(results.base,0)
            or coalesce(native.tax,0)<>coalesce(results.tax,0)
    """,
    )[0][0]
    require(mismatches == 0, "Monthly outcomes differ from Finances activity")
    return mature_cutoff_date, {
        "mature_cutoff_date": mature_cutoff_date.isoformat(),
        "latest_month": policy["latest_month"],
        "monthly_outcomes_reconcile": True,
    }
