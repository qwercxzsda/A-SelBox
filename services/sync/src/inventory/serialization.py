"""Inventory archive manifest serialization without private API transport data."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import cast
from uuid import UUID

from ..amazon.datetimes import parse_amazon_datetime
from ..archives.serialization import document_from_payload
from ..source_serialization import source_mapping
from .models import InventoryAcquisition


def inventory_payload(acquisition: InventoryAcquisition) -> dict[str, object]:
    payload = source_mapping(acquisition)
    payload["document_sha256"] = acquisition.document.document_sha256
    return payload


def inventory_from_payload(payload: Mapping[str, object]) -> InventoryAcquisition:
    archive = document_from_payload(mapping(payload["document"]))
    if archive.document_sha256 != payload["document_sha256"]:
        raise ValueError("Inventory acquisition and archive document digests disagree.")
    capture_date = payload["capture_date"]
    return InventoryAcquisition(
        id=UUID(str(payload["id"])),
        seller_namespace=text(payload["seller_namespace"]),
        amazon_scope=text(payload["amazon_scope"]),
        marketplace_id=text(payload["marketplace_id"]),
        marketplace_name=text(payload["marketplace_name"]),
        capture_date=capture_date
        if type(capture_date) is date
        else date.fromisoformat(text(capture_date)),
        report_type=text(payload["report_type"]),
        report_id=text(payload["report_id"]),
        report_document_id=text(payload["report_document_id"]),
        report_created_at=timestamp(payload["report_created_at"]),
        downloaded_at=timestamp(payload["downloaded_at"]),
        document=archive,
        api_metadata=mapping(payload["api_metadata"]),
    )


def mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("Inventory metadata must be an object.")
    return cast(Mapping[str, object], value)


def text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Inventory metadata text must be a string.")
    return value


def timestamp(value: object) -> datetime:
    return value if isinstance(value, datetime) else parse_amazon_datetime(text(value))
