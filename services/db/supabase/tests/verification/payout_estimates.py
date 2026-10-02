"""Compare live monthly estimates with frozen reports using authenticated reads."""

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


def verify_record_parity(
    connection: Connection, user: str, report: tuple[Any, ...]
) -> tuple[int, int]:
    """Every paginated live record must have the same saved source and amounts."""
    report_id, company, start, end, currency, *_ = report
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
            "from public.company_payout_report_components where report_id=%s "
            "and authoritative",
            (report_id,),
        )
    }
    actual: set[tuple[Any, ...]] = set()
    offset = 0
    while True:
        page = as_user(
            connection,
            user,
            "select public.transaction_page(p_date_from=>%s,p_date_to=>%s,"
            "p_company_ids=>array[%s]::uuid[],p_currency=>%s,"
            "p_limit=>1000,p_offset=>%s,p_include_count=>true)",
            (start, end, company, currency, offset),
        )[0][0]
        require(int(page["total_count"]) == len(expected), "Estimate record count differs")
        for row in page["rows"]:
            actual.add(
                (
                    row["source"],
                    row["source_row_id"],
                    row["activity_date"],
                    row["sku"],
                    row["component_type"],
                    Decimal(row["source_amount"]),
                    Decimal(row["fee_amount"]),
                    Decimal(row["company_amount"]),
                )
            )
        offset += len(page["rows"])
        if len(page["rows"]) < 1000:
            break
    require(actual == expected, "Live estimate records differ from frozen payout records")
    require(offset == len(actual), "Paginated estimate records were duplicated")
    return len(actual), sum(row[5] == 0 for row in actual)


def verify_estimate_parity(connection: Connection, operator: str) -> dict[str, object]:
    """Match latest complete monthly reports, types, and records for both roles."""
    reports = connection.execute(
        "select id,company_id,start_date,end_date,currency,source_amount,fee_amount,"
        "company_amount from public.latest_company_payout_reports where currency is not null"
    ).fetchall()
    require(bool(reports), "No monetary reports were available for estimate comparison")
    members = dict(
        connection.execute(
            "select company_id,user_id::text from public.app_accounts "
            "where access_role='company_member'"
        ).fetchall()
    )
    records = 0
    zero_amount_records = 0
    type_groups = 0
    for report in reports:
        report_id, company, start, end, currency, *header_amounts = report
        for user in (operator, members[company]):
            for grouped in (False, True):
                frozen = as_user(
                    connection,
                    user,
                    "select public.payout_report_totals(%s,p_group_by_type=>%s)",
                    (report_id, grouped),
                )[0][0]
                live = as_user(
                    connection,
                    user,
                    "select public.transaction_totals(p_date_from=>%s,p_date_to=>%s,"
                    "p_company_ids=>array[%s]::uuid[],p_currency=>%s,p_group_by_type=>%s)",
                    (start, end, company, currency, grouped),
                )[0][0]
                require(
                    normalized_totals(live) == normalized_totals(frozen),
                    "Monthly estimate and frozen payout totals differ",
                )
                if not grouped:
                    amounts = [
                        sum((Decimal(row[key]) for row in frozen["rows"]), Decimal(0))
                        for key in ("reported_amount", "service_fee", "company_amount")
                    ]
                    require(amounts == header_amounts, "Type totals differ from the saved header")
            if user == operator:
                type_groups += len(frozen["rows"])
        record_count, zero_count = verify_record_parity(connection, members[company], report)
        records += record_count
        zero_amount_records += zero_count
    return {
        "company_currency_reports": len(reports),
        "type_groups": type_groups,
        "records": records,
        "zero_amount_records": zero_amount_records,
        "operator_and_member_totals_match": True,
        "exact_type_amounts_and_counts_match": True,
        "paginated_records_and_amounts_match": True,
    }
