"""Atomic persistence of complete Data Kiosk observations and immutable day versions."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import uuid7

from psycopg import Cursor
from psycopg.errors import SerializationFailure
from psycopg.rows import dict_row

from ..archives.models import DataKioskAcquisition
from ..data_kiosk_economics.models import DataKioskDay, DataKioskTransaction
from ..data_kiosk_economics.validation import validate_data_kiosk_days
from ..preprocess_version import PREPROCESS_VERSION
from .connection import DatabaseConnection
from .source_writes import copy_rows, require_read_committed
from .values import required_text


@dataclass(frozen=True, slots=True)
class DataKioskSelection:
    version_id: str | None
    batch_id: str | None


def current_data_kiosk_selections(
    database: DatabaseConnection,
    acquisition: DataKioskAcquisition,
    marketplace_name: str,
) -> dict[date, DataKioskSelection]:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT activity_date, current_version_id, current_batch_id "
            "FROM private.data_kiosk_days "
            "WHERE seller_namespace = %s AND marketplace_name = %s AND dataset_key = 'economics' "
            "AND activity_date BETWEEN %s AND %s",
            (
                acquisition.seller_namespace,
                marketplace_name,
                acquisition.query_start_date,
                acquisition.query_end_date,
            ),
        )
        return {
            day: DataKioskSelection(
                None if version is None else str(version), None if batch is None else str(batch)
            )
            for day, version, batch in cursor.fetchall()
        }


def publish_data_kiosk(
    database: DatabaseConnection,
    acquisition: DataKioskAcquisition,
    days: Sequence[DataKioskDay],
    expected_current_selections: Mapping[date, DataKioskSelection],
    *,
    preprocess_version: str = PREPROCESS_VERSION,
) -> str:
    """Lock identities in date order, validate expectations, and save all days together."""
    ordered = validate_data_kiosk_days(acquisition, days)
    preprocess_version = required_text(preprocess_version, "preprocess_version")
    batch_id = str(uuid7())
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        require_read_committed(cursor)
        cursor.execute(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended('company_payout_inputs',0))"
        )
        scope_expanded = _scope_expanded(cursor, acquisition, ordered)
        cursor.execute(
            "INSERT INTO private.data_kiosk_preprocess_batches "
            "(id,acquisition_id,preprocess_version,day_count) VALUES (%s,%s,%s,%s)",
            (batch_id, str(acquisition.id), preprocess_version, len(ordered)),
        )
        changed_months: set[date] = set()
        for day in ordered:
            selected = expected_current_selections.get(
                day.activity_date, DataKioskSelection(None, None)
            )
            if _persist_day(cursor, acquisition, day, selected, batch_id):
                changed_months.add(day.activity_date.replace(day=1))
        cursor.execute(
            "SELECT private.request_payout_report_refresh(%s::date[])", (sorted(changed_months),)
        )
        if scope_expanded:
            cursor.execute("SELECT private.request_all_payout_report_refreshes()")
    return batch_id


def _scope_expanded(
    cursor: Cursor[dict[str, Any]], acquisition: DataKioskAcquisition, days: Sequence[DataKioskDay]
) -> bool:
    skus = sorted({row.sku for day in days for row in day.transactions if row.sku is not None})
    cursor.execute(
        "SELECT private.payout_source_has_new_skus(%s,%s::text[]) OR NOT EXISTS("
        "SELECT 1 FROM private.data_kiosk_days WHERE seller_namespace=%s "
        "AND marketplace_name=%s AND dataset_key='economics') AS expanded",
        (
            acquisition.seller_namespace,
            skus,
            acquisition.seller_namespace,
            days[0].marketplace_name,
        ),
    )
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Data Kiosk scope lookup returned no result.")
    return bool(row["expanded"])


def _persist_day(
    cursor: Cursor[dict[str, Any]],
    acquisition: DataKioskAcquisition,
    day: DataKioskDay,
    expected: DataKioskSelection,
    batch_id: str,
) -> bool:
    cursor.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
        "'data-kiosk',%s::text,%s::text,%s::text,'economics')::text,0))",
        (acquisition.seller_namespace, day.marketplace_name, day.activity_date.isoformat()),
    )
    cursor.execute(
        "INSERT INTO private.data_kiosk_days "
        "(seller_namespace,marketplace_name,activity_date,dataset_key) "
        "VALUES (%s,%s,%s,'economics') ON CONFLICT "
        "(seller_namespace,marketplace_name,activity_date,dataset_key) DO NOTHING",
        (acquisition.seller_namespace, day.marketplace_name, day.activity_date),
    )
    cursor.execute(
        "SELECT d.id,d.current_version_id,d.current_batch_id,a.root_query_created_at,"
        "a.id AS acquisition_id FROM private.data_kiosk_days d "
        "LEFT JOIN private.data_kiosk_preprocess_batches b ON b.id=d.current_batch_id "
        "LEFT JOIN private.data_kiosk_acquisitions a ON a.id=b.acquisition_id "
        "WHERE d.seller_namespace=%s AND d.marketplace_name=%s AND d.activity_date=%s "
        "AND d.dataset_key='economics' FOR UPDATE OF d",
        (acquisition.seller_namespace, day.marketplace_name, day.activity_date),
    )
    current = cursor.fetchone()
    if current is None:
        raise RuntimeError("Data Kiosk day identity was not persisted.")
    selection = DataKioskSelection(
        None if current["current_version_id"] is None else str(current["current_version_id"]),
        None if current["current_batch_id"] is None else str(current["current_batch_id"]),
    )
    if selection != expected:
        raise SerializationFailure("Stale Data Kiosk day publication.")
    version_id = _persist_version(cursor, str(current["id"]), day)
    cursor.execute(
        "INSERT INTO private.data_kiosk_preprocess_batch_days (batch_id,day_id,version_id) "
        "VALUES (%s,%s,%s)",
        (batch_id, current["id"], version_id),
    )
    incoming = acquisition.root_query_created_at, str(acquisition.id), batch_id
    newer = current["current_batch_id"] is None or incoming > (
        current["root_query_created_at"],
        str(current["acquisition_id"]),
        str(current["current_batch_id"]),
    )
    if newer:
        cursor.execute(
            "UPDATE private.data_kiosk_days SET current_version_id=%s,current_batch_id=%s "
            "WHERE id=%s",
            (version_id, batch_id, current["id"]),
        )
    return newer


def _persist_version(cursor: Cursor[dict[str, Any]], day_id: str, day: DataKioskDay) -> str:
    cursor.execute(
        "SELECT id FROM private.data_kiosk_day_versions WHERE day_id=%s AND content_sha256=%s",
        (day_id, day.content_sha256),
    )
    existing = cursor.fetchone()
    if existing is not None:
        return str(existing["id"])
    version_id = str(uuid7())
    cursor.execute(
        "INSERT INTO private.data_kiosk_day_versions "
        "(id,day_id,activity_at,row_count,content_sha256) "
        "VALUES (%s,%s,%s,%s,%s)",
        (version_id, day_id, day.activity_at, len(day.transactions), day.content_sha256),
    )
    copy_rows(
        cursor,
        "COPY private.data_kiosk_day_components "
        "(id,version_id,component_key,sku,category,component_type,"
        "amount,currency,quantity,fee_base) "
        "FROM STDIN",
        [_component_row(row, version_id) for row in day.transactions],
    )
    return version_id


def _component_row(row: DataKioskTransaction, version_id: str) -> tuple[object, ...]:
    return (
        str(uuid7()),
        version_id,
        row.component_key,
        row.sku,
        row.category.value,
        row.component_type,
        row.amount.value,
        row.currency,
        None if row.quantity is None else row.quantity.value,
        None if row.fee_base is None else row.fee_base.value,
    )
