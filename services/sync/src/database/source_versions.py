"""Atomic successful source publication; no intermediate rows or fee lookups."""

from collections.abc import Mapping, Sequence
from uuid import uuid7

from ..archives.models import DataKioskAcquisition
from ..data_kiosk_economics.models import DataKioskDay
from ..preprocess_version import PREPROCESS_VERSION
from ..source_serialization import source_mapping
from .connection import DatabaseConnection
from .publication import publish_json


def current_data_kiosk_versions(
    database: DatabaseConnection,
    acquisition: DataKioskAcquisition,
    marketplace_name: str,
) -> dict[str, str | None]:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT activity_date, current_version_id FROM private.data_kiosk_days "
            "WHERE seller_namespace = %s AND marketplace_name = %s AND dataset_key = 'economics' "
            "AND activity_date BETWEEN %s AND %s",
            (
                acquisition.seller_namespace,
                marketplace_name,
                acquisition.query_start_date,
                acquisition.query_end_date,
            ),
        )
        return {str(row[0]): None if row[1] is None else str(row[1]) for row in cursor.fetchall()}


def publish_data_kiosk(
    database: DatabaseConnection,
    acquisition: DataKioskAcquisition,
    days: Sequence[DataKioskDay],
    expected_current_versions: Mapping[str, str | None],
) -> str:
    batch_id = str(uuid7())
    payload: dict[str, object] = {
        "id": batch_id,
        "acquisition_id": str(acquisition.id),
        "preprocess_version": PREPROCESS_VERSION,
        "dataset_key": "economics",
        "days": [
            {
                "id": str(uuid7()),
                "marketplace_name": day.marketplace_name,
                "activity_date": day.activity_date.isoformat(),
                "content_sha256": day.content_sha256,
                "expected_current_version_id": expected_current_versions.get(
                    day.activity_date.isoformat()
                ),
                "transactions": [
                    {"id": str(uuid7()), **source_mapping(row)} for row in day.transactions
                ],
            }
            for day in days
        ],
    }
    return publish_json(
        database,
        "SELECT private.publish_data_kiosk_preprocess(%(payload)s)",
        payload,
        expected_id=batch_id,
    )
