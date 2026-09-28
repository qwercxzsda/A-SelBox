"""Commit one complete JSON publication and validate its returned identity."""

from collections.abc import Mapping
from typing import LiteralString

from psycopg.types.json import Jsonb

from .connection import DatabaseConnection
from .values import normalize_uuid


def publish_json(
    database: DatabaseConnection,
    statement: LiteralString,
    payload: Mapping[str, object],
    *,
    expected_id: str | None = None,
) -> str:
    """Run a trusted publication statement in one transaction.

    Acquisition and payout deduplication may return an existing ID. New source results and
    fee versions instead require the exact ID generated for their payload.
    """
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(statement, {"payload": Jsonb(payload)})
        row = cursor.fetchone()
        if row is None or len(row) != 1:
            raise RuntimeError("Publication did not return its identity.")
        published_id = normalize_uuid(row[0], "published_id")
        if expected_id is not None and published_id != expected_id:
            raise RuntimeError("Publication returned an unexpected identity.")
    return published_id
