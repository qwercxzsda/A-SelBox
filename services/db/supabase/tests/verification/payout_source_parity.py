"""Compare source-local financial allocations with frozen payout reports."""

from datetime import date
from decimal import Decimal
from typing import Any

from .financial_seed import Connection, as_user, require


def normalized_totals(value: dict[str, Any]) -> set[tuple[Any, ...]]:
    """Normalize exact numeric strings without changing their precision."""
    require(value["next_offset"] is None, "The type catalog exceeded a complete totals page")
    return {
        (
            row["currency"],
            row["component_type"],
            *(
                Decimal(row[key]) if row[key] is not None else None
                for key in (
                    "reported_amount",
                    "service_fee",
                    "company_amount",
                    "row_count",
                    "known_company_count",
                )
            ),
        )
        for row in value["rows"]
    }


def source_period_totals(
    connection: Connection,
    user: str,
    start: date,
    end: date,
    company: str,
    currency: str,
    marketplace: str,
    grouped: bool,
) -> dict[str, Any]:
    """Payout periods follow source accounting dates, not the Transactions UTC calendar."""
    return as_user(
        connection,
        user,
        """
        with totals as (
            select currency, case when %s then component_type end as component_type,
                sum(source_amount)::text as reported_amount,
                sum(fee_amount)::text as service_fee, sum(company_amount)::text as company_amount,
                count(*)::text as row_count, count(company_amount)::text as known_company_count
            from public.live_company_components
            where authoritative and activity_date between %s and %s
                and company_id=%s::uuid and currency=%s and marketplace_name=%s
            group by 1,2
        ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(t)
            order by currency collate "C",component_type collate "C" nulls first),'[]'::jsonb),
            'next_offset',null) from totals t
        """,
        (grouped, start, end, company, currency, marketplace),
    )[0][0]


def verify_record_parity(
    connection: Connection, user: str, report: tuple[Any, ...]
) -> tuple[int, int]:
    """Each source-local allocation must have the same saved source and amounts."""
    report_id, company, start, end, currency, *_ = report
    marketplace = report[8]
    require(marketplace is not None, "Monetary source comparison requires a named marketplace")
    expected = {
        (
            source,
            str(source_id),
            str(day),
            sku,
            component_type,
            amount,
            fee,
            company_amount,
        )
        for source, source_id, day, sku, component_type, amount, fee, company_amount in as_user(
            connection,
            user,
            "select source,source_row_id,activity_date,sku,component_type,"
            "source_amount,fee_amount,company_amount "
            "from private.read_payout_report_records(%s) "
            "where authoritative",
            (report_id,),
        )
    }
    actual = {
        (source, str(source_id), str(day), sku, component_type, amount, fee, company_amount)
        for source, source_id, day, sku, component_type, amount, fee, company_amount in as_user(
            connection,
            user,
            "select source,source_row_id,activity_date,sku,component_type,"
            "source_amount,fee_amount,company_amount "
            "from public.live_company_components where authoritative "
            "and activity_date between %s and %s "
            "and company_id=%s::uuid and currency=%s and marketplace_name=%s",
            (start, end, company, currency, marketplace),
        )
    }
    require(actual == expected, "Current source allocations differ from frozen payout records")
    return len(actual), sum(row[5] == 0 for row in actual)


def verify_payout_source_parity(connection: Connection, administrator: str) -> dict[str, object]:
    """Match latest complete monthly reports, types, and records for both roles."""
    reports = connection.execute(
        "select id,company_id,start_date,end_date,currency,source_amount,fee_amount,"
        "company_amount,marketplace_name from public.latest_company_payout_reports "
        "where currency is not null"
    ).fetchall()
    require(bool(reports), "No monetary reports were available for source comparison")
    members = dict(
        connection.execute(
            "select company_id,user_id::text from public.app_accounts where access_role='member'"
        ).fetchall()
    )
    records = 0
    zero_amount_records = 0
    type_groups = 0
    for report in reports:
        report_id, company, start, end, currency, source, fee, amount, marketplace = report
        require(marketplace is not None, "Monetary source comparison requires a named marketplace")
        for user in (administrator, members[company]):
            for grouped in (False, True):
                frozen = as_user(
                    connection,
                    user,
                    "select public.payout_report_totals(%s,p_group_by_type=>%s)",
                    (report_id, grouped),
                )[0][0]
                live = source_period_totals(
                    connection, user, start, end, company, currency, marketplace, grouped
                )
                require(
                    normalized_totals(live) == normalized_totals(frozen),
                    "Current source and frozen payout totals differ",
                )
                if not grouped:
                    amounts = [
                        sum((Decimal(row[key]) for row in frozen["rows"]), Decimal(0))
                        for key in ("reported_amount", "service_fee", "company_amount")
                    ]
                    require(
                        amounts == [source, fee, amount], "Type totals differ from the saved header"
                    )
            if user == administrator:
                type_groups += len(frozen["rows"])
        record_count, zero_count = verify_record_parity(connection, members[company], report)
        records += record_count
        zero_amount_records += zero_count
    return {
        "company_marketplace_currency_reports": len(reports),
        "type_groups": type_groups,
        "records": records,
        "zero_amount_records": zero_amount_records,
        "administrator_and_member_totals_match": True,
        "exact_type_amounts_and_counts_match": True,
        "source_records_and_amounts_match": True,
    }
