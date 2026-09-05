"""SQL for atomic lossless Settlement V2 report persistence."""

SELECT_STORED_SETTLEMENT_IDENTITIES_SQL: str = """
    with candidate as (
        select
            identity.amazon_report_id,
            identity.amazon_document_id,
            identity.ordinal
        from unnest(
            %(amazon_report_ids)s::text[],
            %(amazon_document_ids)s::text[]
        ) with ordinality as identity(
            amazon_report_id,
            amazon_document_id,
            ordinal
        )
    )
    select
        candidate.ordinal,
        report.amazon_report_id,
        report.amazon_document_id,
        report.amazon_report_created_at,
        report.marketplace_ids,
        report.amazon_report_data_start_at,
        report.amazon_report_data_end_at
    from candidate
    inner join private.settlement_reports as report
      on report.seller_namespace = %(seller_namespace)s
     and report.amazon_scope = %(amazon_scope)s
     and (
         report.amazon_report_id = candidate.amazon_report_id
         or report.amazon_document_id = candidate.amazon_document_id
     )
    order by candidate.ordinal, report.id
"""

LOCK_SETTLEMENT_IDENTITIES_SQL: str = """
    select pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(identity_key.value, 0)
    )
    from unnest(array[
        'settlement-report:'
            || %(seller_namespace)s || ':'
            || %(amazon_scope)s || ':'
            || %(amazon_report_id)s,
        'settlement-document:'
            || %(seller_namespace)s || ':'
            || %(amazon_scope)s || ':'
            || %(amazon_document_id)s
    ]) as identity_key(value)
    order by identity_key.value
"""

SELECT_MATCHING_SETTLEMENT_IDENTITIES_SQL: str = """
    select
        report.amazon_report_id,
        report.amazon_document_id,
        report.amazon_report_created_at,
        report.marketplace_ids,
        report.amazon_report_data_start_at,
        report.amazon_report_data_end_at
    from private.settlement_reports as report
    where report.seller_namespace = %(seller_namespace)s
      and report.amazon_scope = %(amazon_scope)s
      and (
          report.amazon_report_id = %(amazon_report_id)s
          or report.amazon_document_id = %(amazon_document_id)s
      )
    order by report.id
    for update of report
"""

INSERT_SETTLEMENT_REPORT_SQL: str = """
    insert into private.settlement_reports (
        seller_namespace,
        amazon_scope,
        amazon_report_id,
        amazon_document_id,
        amazon_report_created_at,
        amazon_report_data_start_at,
        amazon_report_data_end_at,
        marketplace_ids,
        marketplace_names,
        tsv_columns,
        metadata_source_line_number,
        metadata_values,
        decoded_content_sha256,
        content_row_count
    )
    values (
        %(seller_namespace)s,
        %(amazon_scope)s,
        %(amazon_report_id)s,
        %(amazon_document_id)s,
        %(amazon_report_created_at)s,
        %(amazon_report_data_start_at)s,
        %(amazon_report_data_end_at)s,
        %(marketplace_ids)s,
        %(marketplace_names)s,
        %(tsv_columns)s,
        %(metadata_source_line_number)s,
        %(metadata_values)s,
        %(decoded_content_sha256)s,
        %(content_row_count)s
    )
    returning id::text
"""

INSERT_SETTLEMENT_REPORT_ROW_SQL: str = """
    insert into private.settlement_report_rows (
        settlement_report_id,
        source_line_number,
        column_values
    )
    values (
        %(settlement_report_id)s::uuid,
        %(source_line_number)s,
        %(column_values)s
    )
"""

__all__ = [
    "INSERT_SETTLEMENT_REPORT_ROW_SQL",
    "INSERT_SETTLEMENT_REPORT_SQL",
    "LOCK_SETTLEMENT_IDENTITIES_SQL",
    "SELECT_MATCHING_SETTLEMENT_IDENTITIES_SQL",
    "SELECT_STORED_SETTLEMENT_IDENTITIES_SQL",
]
