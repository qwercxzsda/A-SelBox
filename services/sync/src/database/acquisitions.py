"""Successful acquisition publication and offline manifest retrieval."""

from collections.abc import Mapping
from typing import Literal, cast
from uuid import UUID

from psycopg.rows import dict_row

from ..archives.models import DataKioskAcquisition, SettlementAcquisition
from ..archives.serialization import (
    data_kiosk_from_payload,
    data_kiosk_payload,
    settlement_from_payload,
    settlement_payload,
)
from ..inventory.models import InventoryAcquisition
from ..inventory.serialization import inventory_from_payload, inventory_payload
from .connection import DatabaseConnection
from .publication import publish_json
from .values import normalize_uuid


def persist_settlement_acquisition(
    database: DatabaseConnection, acquisition: SettlementAcquisition
) -> str:
    return publish_json(
        database,
        "SELECT private.publish_settlement_acquisition(%(payload)s)",
        settlement_payload(acquisition),
    )


def persist_data_kiosk_acquisition(
    database: DatabaseConnection, acquisition: DataKioskAcquisition
) -> str:
    return publish_json(
        database,
        "SELECT private.publish_data_kiosk_acquisition(%(payload)s)",
        data_kiosk_payload(acquisition),
    )


def persist_inventory_acquisition(
    database: DatabaseConnection, acquisition: InventoryAcquisition
) -> str:
    return publish_json(
        database,
        "SELECT private.publish_inventory_acquisition(%(payload)s)",
        inventory_payload(acquisition),
    )


def load_settlement_acquisition(
    database: DatabaseConnection, acquisition_id: str | UUID
) -> SettlementAcquisition:
    return settlement_from_payload(_load(database, "settlement", acquisition_id))


def load_data_kiosk_acquisition(
    database: DatabaseConnection, acquisition_id: str | UUID
) -> DataKioskAcquisition:
    return data_kiosk_from_payload(_load(database, "data_kiosk", acquisition_id))


def load_inventory_acquisition(
    database: DatabaseConnection, acquisition_id: str | UUID
) -> InventoryAcquisition:
    return inventory_from_payload(_load(database, "inventory", acquisition_id))


def _load(
    database: DatabaseConnection,
    source: Literal["settlement", "data_kiosk", "inventory"],
    acquisition_id: str | UUID,
) -> Mapping[str, object]:
    identifier = normalize_uuid(acquisition_id, "acquisition_id")
    statement = {
        "settlement": "SELECT * FROM private.settlement_acquisitions WHERE id = %s",
        "data_kiosk": "SELECT * FROM private.data_kiosk_acquisitions WHERE id = %s",
        "inventory": "SELECT * FROM private.inventory_acquisitions WHERE id = %s",
    }[source]
    with database.connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(statement, (identifier,))
        row = cursor.fetchone()
    if row is None:
        raise LookupError("A completed saved acquisition is required for offline preprocessing.")
    return cast(Mapping[str, object], row)
