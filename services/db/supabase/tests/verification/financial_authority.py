"""Compare live authority with independent sums over real source components."""

import calendar
from collections import defaultdict
from datetime import date
from typing import Any

from services.db.supabase.tests.verification.financial_seed import Connection, as_user, require

# Per seller account and region: the FINANCES control equals the native activity amounts, and
# the outcomes (COMPANY, SELBOX and DIFFERENCE) add up to it, for base and tax alike.
_ACCOUNT_MISMATCHES = """
    with native as (select seller_namespace,amazon_scope,marketplace_name,currency,
        date_trunc('month',posted_date)::date as month,
        sum(case when amount_part='TAX' then 0 else amount end) as base,
        sum(case when amount_part='TAX' then amount else 0 end) as tax
        from private.finances_component_details
        where is_current and activity_eligible group by 1,2,3,4,5),
    measures as (select seller_namespace,amazon_scope,marketplace_name,currency,month,
        sum(base_amount) filter (where measure='FINANCES') as finances_base,
        sum(tax_amount) filter (where measure='FINANCES') as finances_tax,
        sum(base_amount) filter (where measure<>'FINANCES') as outcome_base,
        sum(tax_amount) filter (where measure<>'FINANCES') as outcome_tax
        from private.monthly_outcomes(null,null,null) group by 1,2,3,4,5),
    compared as (select coalesce(native.base,0) as base,coalesce(native.tax,0) as tax,
        coalesce(finances_base,0) as finances_base,coalesce(finances_tax,0) as finances_tax,
        coalesce(outcome_base,0) as outcome_base,coalesce(outcome_tax,0) as outcome_tax
        from native full join measures
        using(seller_namespace,amazon_scope,marketplace_name,currency,month))
    select count(*) from compared
    where (base,tax) <> (finances_base,finances_tax) or (base,tax) <> (outcome_base,outcome_tax)
"""
# Account measures summed per marketplace-year, in the review RPC's row order.
_REVIEW_MONTHS = """
    select marketplace_name,extract(year from month)::int,month,currency,measure,reason,
        selbox_group,sum(base_amount),sum(tax_amount),sum(amount_count)::bigint
    from private.monthly_outcomes(null,null,null) group by 1,3,4,5,6,7
    order by marketplace_name,month,currency collate "C",measure collate "C",
        reason collate "C",selbox_group collate "C"
"""


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
    return mature_cutoff_date, {
        "mature_cutoff_date": mature_cutoff_date.isoformat(),
        "latest_month": policy["latest_month"],
        "monthly_outcomes_reconcile": True,
        "review_month_scopes": verify_review_months(connection, administrator),
    }


def verify_review_months(connection: Connection, administrator: str) -> int:
    """Check every account month, then the administrator's review of each marketplace-year."""
    mismatches = connection.execute(_ACCOUNT_MISMATCHES).fetchall()[0][0]
    require(mismatches == 0, "Monthly outcomes differ from Finances activity")
    scopes: dict[tuple[str, int], list[tuple[Any, ...]]] = defaultdict(list)
    for marketplace, year, *row in connection.execute(_REVIEW_MONTHS):
        scopes[marketplace, year].append(tuple(row))
    for (marketplace, year), expected in scopes.items():
        review = as_user(
            connection,
            administrator,
            "select * from public.financial_review_months(%s,%s)",
            (marketplace, year),
        )
        require(review == expected, "Financial review months differ from account measures")
    return len(scopes)
