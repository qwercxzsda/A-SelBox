"""Current inventory selection and atomic replacement of a complete daily capture."""

from typing import Any
from uuid import uuid7

from psycopg import Cursor, sql
from psycopg.errors import SerializationFailure
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..inventory.models import INVENTORY_PREPROCESS_VERSION, InventoryAcquisition, PreparedInventory
from ..source_serialization import source_json
from .connection import DatabaseConnection
from .source_writes import require_read_committed
from .values import normalize_uuid, required_text

_ITEM_COLUMNS = (
    "sku",
    "source_line_number",
    "snapshot_date",
    "available_quantity",
    "fba_supply_quantity",
    "inbound_quantity",
    "inbound_working_quantity",
    "inbound_shipped_quantity",
    "inbound_received_quantity",
    "reserved_quantity",
    "reserved_transfer_quantity",
    "reserved_processing_quantity",
    "reserved_customer_order_quantity",
    "unfulfillable_quantity",
    "sales_amount_90d",
    "units_shipped_90d",
    "currency",
    "health_status",
    "minimum_inventory_units",
    "days_of_supply",
    "total_days_of_supply",
    "recommended_ship_in_units",
    "recommended_ship_in_date",
    "recommended_action",
)


def current_inventory_capture(
    database: DatabaseConnection, acquisition: InventoryAcquisition
) -> str | None:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id FROM private.inventory_daily_captures "
            "WHERE seller_namespace=%s AND marketplace_name=%s AND capture_date=%s",
            (acquisition.seller_namespace, acquisition.marketplace_name, acquisition.capture_date),
        )
        row = cursor.fetchone()
    return None if row is None else normalize_uuid(row[0], "capture_id")


def publish_inventory_capture(
    database: DatabaseConnection,
    acquisition: InventoryAcquisition,
    prepared: PreparedInventory,
    expected_current_capture_id: str | None,
    *,
    preprocess_version: str = INVENTORY_PREPROCESS_VERSION,
) -> str:
    """Check the selected capture after its identity lock, then replace all rows together."""
    preprocess_version = required_text(preprocess_version, "preprocess_version")
    expected = (
        None
        if expected_current_capture_id is None
        else normalize_uuid(expected_current_capture_id, "expected_current_capture_id")
    )
    capture_id = str(uuid7())
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        require_read_committed(cursor)
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
            "'inventory-capture',%s::text,%s::text,%s::date-date '2000-01-01')::text,0))",
            (acquisition.seller_namespace, acquisition.marketplace_name, acquisition.capture_date),
        )
        cursor.execute(
            "SELECT c.id,c.acquisition_id,c.preprocess_version,a.report_created_at "
            "FROM private.inventory_daily_captures c "
            "JOIN private.inventory_acquisitions a ON a.id=c.acquisition_id "
            "WHERE c.seller_namespace=%s AND c.marketplace_name=%s AND c.capture_date=%s "
            "FOR UPDATE OF c",
            (acquisition.seller_namespace, acquisition.marketplace_name, acquisition.capture_date),
        )
        current = cursor.fetchone()
        if (
            current is not None
            and str(current["acquisition_id"]) == str(acquisition.id)
            and current["preprocess_version"] == preprocess_version
        ):
            return str(current["id"])
        current_id = None if current is None else str(current["id"])
        if current_id != expected:
            raise SerializationFailure("Stale inventory capture publication.")
        if current is not None:
            if (acquisition.report_created_at, str(acquisition.id)) < (
                current["report_created_at"],
                str(current["acquisition_id"]),
            ):
                raise ValueError("An older inventory observation cannot replace newer data.")
            cursor.execute(
                "DELETE FROM private.inventory_daily_captures WHERE id=%s", (current_id,)
            )
        cursor.execute(
            "INSERT INTO private.inventory_daily_captures "
            "(id,seller_namespace,marketplace_name,capture_date,acquisition_id,preprocess_version,"
            "row_count,diagnostics) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                capture_id,
                acquisition.seller_namespace,
                acquisition.marketplace_name,
                acquisition.capture_date,
                str(acquisition.id),
                preprocess_version,
                len(prepared.items),
                Jsonb(source_json(prepared.diagnostics)),
            ),
        )
        _insert_items(cursor, capture_id, prepared)
    return capture_id


def _insert_items(
    cursor: Cursor[dict[str, Any]], capture_id: str, prepared: PreparedInventory
) -> None:
    if not prepared.items:
        return
    statement = sql.SQL("COPY private.inventory_items ({}) FROM STDIN").format(
        sql.SQL(",").join(map(sql.Identifier, ("capture_id", *_ITEM_COLUMNS)))
    )
    with cursor.copy(statement) as copy:
        for item in prepared.items:
            copy.write_row((capture_id, *(item.get(column) for column in _ITEM_COLUMNS)))
