"""Advise administrators when current Settlement runs need new fee assignments."""

import logging

from .connection import DatabaseConnection
from .values import normalize_uuid

_LOGGER = logging.getLogger(__name__)

_CHECK_SQL = """
    select distinct
        result.settlement_report_id::text,
        result.processing_log_id::text
    from private.settlement_processed_results as result
    inner join private.settlement_processing_logs as processing_log
      on processing_log.id = result.processing_log_id
    inner join public.company_sku_fee_rates as recorded_fee
      on recorded_fee.id = result.company_sku_fee_rate_id
    {fee_scope_join}
    where {processing_scope}
      and not exists (
          select 1
          from private.settlement_processing_logs as newer_log
          where newer_log.settlement_report_id = result.settlement_report_id
            and (newer_log.processed_at, newer_log.id)
              > (processing_log.processed_at, processing_log.id)
      )
      and exists (
          select 1
          from public.company_sku_fee_rates as newer_fee
          where newer_fee.seller_namespace = recorded_fee.seller_namespace
            and newer_fee.marketplace_id = recorded_fee.marketplace_id
            and newer_fee.sku = recorded_fee.sku
            and newer_fee.company_id = recorded_fee.company_id
            and (newer_fee.created_at, newer_fee.id)
              > (recorded_fee.created_at, recorded_fee.id)
      )
    order by result.settlement_report_id::text, result.processing_log_id::text
"""

_FEE_SCOPE_JOIN = """
    inner join public.company_sku_fee_rates as selected_fee
      on selected_fee.id = %(fee_rate_id)s::uuid
     and selected_fee.seller_namespace = recorded_fee.seller_namespace
     and selected_fee.marketplace_id = recorded_fee.marketplace_id
     and selected_fee.sku = recorded_fee.sku
     and selected_fee.company_id = recorded_fee.company_id
"""


def check_settlement_fee_references(
    database: DatabaseConnection,
    *,
    processing_log_id: str | None = None,
    fee_rate_id: str | None = None,
) -> tuple[str, ...] | None:
    """Warn once per affected report; return their UUIDs, or None if checking failed.

    Supply one processing-log UUID, one fee UUID (checking its whole company/SKU
    identity), or neither for all current runs. Historical runs and unassigned
    fees are ignored.
    Call after commit: this advisory read never repairs or rejects stored results.
    """
    if processing_log_id is not None and fee_rate_id is not None:
        raise ValueError("Choose a processing_log_id or fee_rate_id, not both.")
    parameters = {
        name: normalize_uuid(value, name)
        for name, value in (
            ("processing_log_id", processing_log_id),
            ("fee_rate_id", fee_rate_id),
        )
        if value is not None
    }
    # Only fixed SQL fragments are interpolated; caller values stay parameters.
    query = _CHECK_SQL.format(
        fee_scope_join=_FEE_SCOPE_JOIN if fee_rate_id is not None else "",
        processing_scope=(
            "result.processing_log_id = %(processing_log_id)s::uuid"
            if processing_log_id is not None
            else "true"
        ),
    )
    try:
        with database.connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, parameters)
            reports = tuple(
                (
                    normalize_uuid(row[0], "settlement_report_id"),
                    normalize_uuid(row[1], "processing_log_id"),
                )
                for row in cursor.fetchall()
            )
    except Exception as error:
        _LOGGER.error(
            "Settlement fee advisory check failed; run it again. "
            "processing_log_id=%s fee_rate_id=%s error_type=%s",
            processing_log_id,
            fee_rate_id,
            type(error).__name__,
        )
        return None
    for report_id, log_id in reports:
        _LOGGER.warning(
            "Settlement fee assignments are outdated; reprocess with "
            "--settlement-report-id %s. processing_log_id=%s",
            report_id,
            log_id,
        )
    return tuple(report_id for report_id, _ in reports)
