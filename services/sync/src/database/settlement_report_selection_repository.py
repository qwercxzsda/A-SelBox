"""Select a report for Workflow B without storing mutable processing flags."""

from .connection import DatabaseConnection
from .seller_namespaces import validate_seller_namespace
from .values import normalize_uuid

_OLDEST_UNPROCESSED_SETTLEMENT_SQL = """
    select report.id::text
    from private.settlement_reports as report
    left join private.settlement_processing_logs as processing_log
      on processing_log.settlement_report_id = report.id
    where report.seller_namespace = %(seller_namespace)s
      and processing_log.id is null
    order by report.amazon_report_created_at, report.id
    limit 1
"""

_EXPLICIT_SETTLEMENT_SQL = """
    select report.id::text
    from private.settlement_reports as report
    where report.id = %(settlement_report_id)s::uuid
      and report.seller_namespace = %(seller_namespace)s
"""


def select_settlement_report_id(
    database: DatabaseConnection,
    *,
    seller_namespace: str,
    settlement_report_id: str | None = None,
) -> str | None:
    """Select an explicit report for reprocessing or the oldest never processed report."""
    seller = validate_seller_namespace(seller_namespace)
    explicit_id = (
        normalize_uuid(settlement_report_id, "settlement_report_id")
        if settlement_report_id is not None
        else None
    )
    query = (
        _EXPLICIT_SETTLEMENT_SQL if explicit_id is not None else _OLDEST_UNPROCESSED_SETTLEMENT_SQL
    )
    parameters: dict[str, object] = {"seller_namespace": seller}
    if explicit_id is not None:
        parameters["settlement_report_id"] = explicit_id
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(query, parameters)
        row = cursor.fetchone()
    if row is None:
        if explicit_id is not None:
            raise ValueError("Unknown Settlement report for the selected seller namespace.")
        return None
    if len(row) != 1:
        raise RuntimeError("Settlement report selection returned an unexpected row.")
    return normalize_uuid(row[0], "settlement_report_id")


__all__ = ["select_settlement_report_id"]
