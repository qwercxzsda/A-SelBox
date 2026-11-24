"""Check persisted line arithmetic independently against a payout header."""

from typing import Any

from .financial_seed import Connection


def independent_payout_totals(connection: Connection, report_id: str) -> tuple[Any, ...]:
    return connection.execute(
        """select coalesce(sum(base_amount + tax_amount),0),coalesce(sum(fee_amount),0),
           coalesce(sum(base_amount + tax_amount + fee_amount),0)
           from private.read_payout_report_records(%s)""",
        (report_id,),
    ).fetchall()[0]
