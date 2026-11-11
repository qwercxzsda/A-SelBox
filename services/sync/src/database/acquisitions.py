"""Successful acquisition publication and offline manifest retrieval."""

from collections.abc import Mapping
from dataclasses import replace
from typing import Literal, cast
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..archives.models import DataKioskAcquisition
from ..archives.serialization import (
    data_kiosk_from_payload,
    data_kiosk_payload,
)
from ..inventory.models import InventoryAcquisition
from ..inventory.serialization import inventory_from_payload, inventory_payload
from .connection import DatabaseConnection
from .source_writes import require_read_committed
from .values import normalize_uuid


def persist_data_kiosk_acquisition(
    database: DatabaseConnection, acquisition: DataKioskAcquisition
) -> str:
    payload = data_kiosk_payload(acquisition)
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        require_read_committed(cursor)
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
            "'data-kiosk-download',%s::text,%s::text,%s::text)::text,0))",
            (acquisition.seller_namespace, acquisition.amazon_scope, acquisition.root_query_id),
        )
        cursor.execute(
            "SELECT * FROM private.data_kiosk_acquisitions "
            "WHERE seller_namespace=%s AND amazon_scope=%s AND root_query_id=%s",
            (acquisition.seller_namespace, acquisition.amazon_scope, acquisition.root_query_id),
        )
        existing = cursor.fetchone()
        if existing is not None:
            saved = data_kiosk_from_payload(existing)
            if (
                replace(saved, id=acquisition.id, downloaded_at=acquisition.downloaded_at)
                != acquisition
            ):
                raise ValueError(
                    "Data Kiosk observation identity conflicts with its saved manifest."
                )
            return str(saved.id)
        cursor.execute(
            "INSERT INTO private.data_kiosk_acquisitions "
            "(id,seller_namespace,amazon_scope,root_query_id,root_query_created_at,schema_version,"
            "query_definition,marketplace_ids,query_start_date,query_end_date,api_metadata,"
            "downloaded_at,documents) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                str(acquisition.id),
                acquisition.seller_namespace,
                acquisition.amazon_scope,
                acquisition.root_query_id,
                acquisition.root_query_created_at,
                acquisition.schema_version,
                acquisition.query_definition,
                [acquisition.marketplace_id],
                acquisition.query_start_date,
                acquisition.query_end_date,
                Jsonb(payload["api_metadata"]),
                acquisition.downloaded_at,
                Jsonb(payload["documents"]),
            ),
        )
    return str(acquisition.id)


def persist_inventory_acquisition(
    database: DatabaseConnection, acquisition: InventoryAcquisition
) -> str:
    payload = inventory_payload(acquisition)
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        require_read_committed(cursor)
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
            "'inventory-acquisition',%s::text,%s::text,%s::text)::text,0))",
            (acquisition.seller_namespace, acquisition.amazon_scope, acquisition.report_id),
        )
        cursor.execute(
            "SELECT id,marketplace_id,marketplace_name,capture_date,report_type,"
            "report_document_id,report_created_at,document_sha256 "
            "FROM private.inventory_acquisitions "
            "WHERE seller_namespace=%s AND amazon_scope=%s AND report_id=%s",
            (acquisition.seller_namespace, acquisition.amazon_scope, acquisition.report_id),
        )
        existing = cursor.fetchone()
        if existing is not None:
            identity_fields = (
                "marketplace_id",
                "marketplace_name",
                "capture_date",
                "report_type",
                "report_document_id",
                "report_created_at",
            )
            if (
                any(existing[field] != getattr(acquisition, field) for field in identity_fields)
                or existing["document_sha256"] != acquisition.document.document_sha256
            ):
                raise ValueError("Known inventory report changed identity or decoded bytes.")
            return str(existing["id"])
        cursor.execute(
            "INSERT INTO private.inventory_acquisitions "
            "(id,seller_namespace,amazon_scope,marketplace_id,marketplace_name,capture_date,"
            "report_type,report_id,report_document_id,report_created_at,downloaded_at,"
            "document_sha256,document,api_metadata) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                str(acquisition.id),
                acquisition.seller_namespace,
                acquisition.amazon_scope,
                acquisition.marketplace_id,
                acquisition.marketplace_name,
                acquisition.capture_date,
                acquisition.report_type,
                acquisition.report_id,
                acquisition.report_document_id,
                acquisition.report_created_at,
                acquisition.downloaded_at,
                acquisition.document.document_sha256,
                Jsonb(payload["document"]),
                Jsonb(payload["api_metadata"]),
            ),
        )
    return str(acquisition.id)


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
    source: Literal["data_kiosk", "inventory"],
    acquisition_id: str | UUID,
) -> Mapping[str, object]:
    identifier = normalize_uuid(acquisition_id, "acquisition_id")
    statement = {
        "data_kiosk": "SELECT * FROM private.data_kiosk_acquisitions WHERE id = %s",
        "inventory": "SELECT * FROM private.inventory_acquisitions WHERE id = %s",
    }[source]
    with database.connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(statement, (identifier,))
        row = cursor.fetchone()
    if row is None:
        raise LookupError("A completed saved acquisition is required for offline preprocessing.")
    return cast(Mapping[str, object], row)
