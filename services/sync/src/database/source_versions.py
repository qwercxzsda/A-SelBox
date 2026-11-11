"""Atomic successful source publication; no intermediate rows or fee lookups."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from uuid import uuid7

from ..archives.models import DataKioskAcquisition
from ..data_kiosk_economics.models import DataKioskDay
from ..preprocess_version import PREPROCESS_VERSION
from ..source_serialization import source_mapping
from .connection import DatabaseConnection
from .publication import publish_json


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
                None if version is None else str(version),
                None if batch is None else str(batch),
            )
            for day, version, batch in cursor.fetchall()
        }


def publish_data_kiosk(
    database: DatabaseConnection,
    acquisition: DataKioskAcquisition,
    days: Sequence[DataKioskDay],
    expected_current_selections: Mapping[date, DataKioskSelection],
) -> str:
    batch_id = str(uuid7())
    payload: dict[str, object] = {
        "id": batch_id,
        "acquisition_id": str(acquisition.id),
        "preprocess_version": PREPROCESS_VERSION,
        "dataset_key": "economics",
        "days": [
            _day_payload(day, expected_current_selections.get(day.activity_date)) for day in days
        ],
    }
    return publish_json(
        database,
        "SELECT private.publish_data_kiosk_preprocess(%(payload)s)",
        payload,
        expected_id=batch_id,
    )


def _day_payload(day: DataKioskDay, selected: DataKioskSelection | None) -> dict[str, object]:
    return {
        "id": str(uuid7()),
        "marketplace_name": day.marketplace_name,
        "activity_date": day.activity_date.isoformat(),
        "activity_at": day.activity_at.isoformat(),
        "content_sha256": day.content_sha256,
        "expected_current_version_id": selected.version_id if selected is not None else None,
        "expected_current_batch_id": selected.batch_id if selected is not None else None,
        "transactions": [{"id": str(uuid7()), **source_mapping(row)} for row in day.transactions],
    }
