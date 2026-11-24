"""Store typed reference rows and their exact source versions."""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID, uuid7

from psycopg import Cursor, sql

from ..source_serialization import content_sha256
from .acquisition import ReferenceRequest

ROW_TABLES = {
    "STORAGE": "storage_rows",
    "AGED_STORAGE": "aged_storage_rows",
    "REMOVAL_ORDER": "removal_order_rows",
    "INVENTORY_LEDGER": "inventory_ledger_rows",
    "AD_INVOICE": "ad_invoice_lines",
}
INFO_TABLES = {
    "CAMPAIGN": ("campaigns", "campaign_products"),
    "PROMOTION": ("promotions", "promotion_products"),
    "SHIPMENT": ("shipments", "shipment_items"),
}


def _insert(cursor: Cursor[Any], table: str, rows: Sequence[Mapping[str, object]]) -> None:
    if not rows:
        return
    columns = sorted({k for row in rows for k in row})
    command = sql.SQL("COPY private.{} ({}) FROM STDIN").format(
        sql.Identifier(table), sql.SQL(",").join(map(sql.Identifier, columns))
    )
    with cursor.copy(command) as copy:
        for row in rows:
            copy.write_row(tuple(row.get(k) for k in columns))


def store_unit(
    cursor: Cursor[Any],
    request: ReferenceRequest,
    batch_id: UUID,
    key: str,
    rows: Sequence[Mapping[str, object]],
    header: Mapping[str, object],
    record_number: int,
) -> bool:
    source = request.source
    identity = source, request.seller, request.scope, key
    cursor.execute(
        "insert into private.source_units (source,seller_namespace,amazon_scope,unit_key) "
        "values(%s,%s,%s,%s) on conflict do nothing",
        identity,
    )
    cursor.execute(
        "select id,current_version_id from private.source_units "
        "where (source,seller_namespace,amazon_scope,unit_key)=(%s,%s,%s,%s) for update",
        identity,
    )
    identity_row = cursor.fetchone()
    if identity_row is None:
        raise RuntimeError("Source identity was not stored.")
    unit, old_version = identity_row[0], identity_row[1]
    digest = content_sha256((header, rows))
    cursor.execute(
        "select id from private.source_unit_versions where unit_id=%s and content_sha256=%s",
        (unit, digest),
    )
    existing = cursor.fetchone()
    version = existing[0] if existing else uuid7()
    if not existing:
        cursor.execute(
            "insert into private.source_unit_versions(id,unit_id,source,content_sha256,row_count) "
            "values(%s,%s,%s,%s,%s)",
            (version, unit, source, digest, len(rows)),
        )
        if source == "AD_INVOICE":
            _insert(cursor, "ad_invoices", [{"version_id": version, **header}])
        extras = (
            {"seller_namespace": request.seller, "amazon_scope": request.scope}
            if source == "INVENTORY_LEDGER"
            else {}
        )
        number = "line_number" if source == "AD_INVOICE" else "row_number"
        _insert(
            cursor,
            ROW_TABLES[source],
            [{"version_id": version, number: i, **extras, **row} for i, row in enumerate(rows, 1)],
        )
    cursor.execute(
        "insert into private.source_batch_units(batch_id,unit_id,version_id,"
        "document_number,record_number) "
        "values (%s,%s,%s,1,%s)",
        (batch_id, unit, version, record_number),
    )
    cursor.execute(
        "update private.source_units set current_version_id=%s,current_batch_id=%s where id=%s",
        (version, batch_id, unit),
    )
    return version != old_version


def store_information(
    cursor: Cursor[Any],
    request: ReferenceRequest,
    batch_id: UUID,
    header: Mapping[str, object],
    rows: Sequence[Mapping[str, object]],
    *,
    missing: bool,
) -> None:
    table, children = INFO_TABLES[request.source]
    kind = request.source.lower()
    cursor.execute(
        sql.SQL(
            "delete from private.{} where seller_namespace=%s and amazon_scope=%s and {}=%s"
        ).format(sql.Identifier(table), sql.Identifier(kind + "_id")),
        (request.seller, request.scope, request.native_id),
    )
    if missing:
        return
    identity = uuid7()
    _insert(
        cursor,
        table,
        [
            dict(
                header,
                id=identity,
                seller_namespace=request.seller,
                amazon_scope=request.scope,
                batch_id=batch_id,
            )
        ],
    )
    _insert(
        cursor,
        children,
        [{kind + "_row_id": identity, "product_number": i, **row} for i, row in enumerate(rows, 1)],
    )
