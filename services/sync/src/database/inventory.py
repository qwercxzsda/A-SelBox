"""Current inventory capture selection and atomic daily-capture publication."""

from uuid import uuid7

from ..inventory.models import INVENTORY_PREPROCESS_VERSION, InventoryAcquisition, PreparedInventory
from ..source_serialization import source_json
from .connection import DatabaseConnection
from .publication import publish_json
from .values import normalize_uuid


def current_inventory_capture(
    database: DatabaseConnection, acquisition: InventoryAcquisition
) -> str | None:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id FROM private.inventory_daily_captures "
            "WHERE seller_namespace = %s AND marketplace_name = %s AND capture_date = %s",
            (acquisition.seller_namespace, acquisition.marketplace_name, acquisition.capture_date),
        )
        row = cursor.fetchone()
    return None if row is None else normalize_uuid(row[0], "capture_id")


def publish_inventory_capture(
    database: DatabaseConnection,
    acquisition: InventoryAcquisition,
    prepared: PreparedInventory,
    expected_current_capture_id: str | None,
) -> str:
    return publish_json(
        database,
        "SELECT private.publish_inventory_capture(%(payload)s)",
        {
            "id": str(uuid7()),
            "seller_namespace": acquisition.seller_namespace,
            "marketplace_name": acquisition.marketplace_name,
            "capture_date": acquisition.capture_date.isoformat(),
            "acquisition_id": str(acquisition.id),
            "preprocess_version": INVENTORY_PREPROCESS_VERSION,
            "row_count": len(prepared.items),
            "diagnostics": source_json(prepared.diagnostics),
            "expected_current_capture_id": expected_current_capture_id,
            "items": source_json(prepared.items),
        },
    )
