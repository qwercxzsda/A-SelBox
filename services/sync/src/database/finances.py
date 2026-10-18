"""Complete Finances day selections and atomic preprocessing publication."""

from collections.abc import Mapping
from uuid import uuid7

from ..finances.acquisition_models import FinancesAcquisition
from ..finances.marketplaces import financial_marketplace_name
from ..finances.models import PreparedFinances
from ..preprocess_version import PREPROCESS_VERSION
from ..source_serialization import source_mapping
from .connection import DatabaseConnection
from .publication import publish_json


def current_finances_versions(
    database: DatabaseConnection, acquisition: FinancesAcquisition
) -> dict[tuple[str, str], str | None]:
    marketplace_ids = {
        financial_marketplace_name(identifier): identifier
        for identifier in acquisition.marketplace_ids
    }
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT marketplace_name, activity_date, current_version_id FROM private.finances_days "
            "WHERE seller_namespace=%s AND activity_date BETWEEN %s AND %s "
            "AND marketplace_name=ANY(%s)",
            (
                acquisition.seller_namespace,
                acquisition.query_start_date,
                acquisition.query_end_date,
                list(marketplace_ids),
            ),
        )
        return {
            (marketplace_ids[str(row[0])], str(row[1])): None if row[2] is None else str(row[2])
            for row in cursor.fetchall()
        }


def publish_finances(
    database: DatabaseConnection,
    acquisition: FinancesAcquisition,
    prepared: PreparedFinances,
    expected: Mapping[tuple[str, str], str | None],
) -> str:
    batch_id = str(uuid7())
    days: list[dict[str, object]] = []
    for day in prepared.days:
        payload = source_mapping(day)
        payload.update(
            id=str(uuid7()),
            expected_current_version_id=expected.get(
                (day.marketplace_id, day.activity_date.isoformat())
            ),
        )
        transactions: list[dict[str, object]] = []
        for transaction in day.transactions:
            row = source_mapping(transaction)
            row["id"] = str(uuid7())
            row["components"] = [
                {"id": str(uuid7()), **source_mapping(c)} for c in transaction.components
            ]
            transactions.append(row)
        payload["transactions"] = transactions
        days.append(payload)
    payload = {
        "id": batch_id,
        "acquisition_id": str(acquisition.id),
        "preprocess_version": PREPROCESS_VERSION,
        "days": days,
        "summaries": [source_mapping(row) for row in prepared.summaries],
    }
    return publish_json(
        database,
        "SELECT private.publish_finances_preprocess(%(payload)s)",
        payload,
        expected_id=batch_id,
    )
