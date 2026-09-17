"""JSON acquisition payloads without source bytes, credentials, or transient URLs."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import cast
from uuid import UUID

from ..amazon.data_kiosk.models import DataKioskDocumentKind
from ..amazon.reports.discovery import SETTLEMENT_REPORT_TYPE
from ..amazon.settlement_models import SettlementReportReference
from ..source_serialization import source_json, source_mapping
from .models import (
    ArchivedDataKioskPage,
    ArchivedDocument,
    DataKioskAcquisition,
    SettlementAcquisition,
)


def settlement_payload(acquisition: SettlementAcquisition) -> dict[str, object]:
    reference = acquisition.reference
    return {
        "id": str(acquisition.id),
        "seller_namespace": acquisition.seller_namespace,
        "amazon_scope": acquisition.amazon_scope,
        "report_id": reference.report_id,
        "report_document_id": reference.report_document_id,
        "report_type": SETTLEMENT_REPORT_TYPE,
        "report_created_at": reference.report_created_at.isoformat(),
        "marketplace_ids": list(reference.marketplace_ids),
        "document_sha256": acquisition.document.document_sha256,
        "downloaded_at": acquisition.downloaded_at.isoformat(),
        "api_metadata": source_json(acquisition.api_metadata),
        "document": source_json(acquisition.document),
    }


def data_kiosk_payload(acquisition: DataKioskAcquisition) -> dict[str, object]:
    payload = source_mapping(acquisition)
    payload["marketplace_ids"] = [payload.pop("marketplace_id")]
    payload["documents"] = payload.pop("pages")
    return payload


def settlement_from_payload(payload: Mapping[str, object]) -> SettlementAcquisition:
    metadata = _mapping(payload["api_metadata"])
    return SettlementAcquisition(
        id=_identifier(payload["id"]),
        seller_namespace=_string(payload["seller_namespace"]),
        amazon_scope=_string(payload["amazon_scope"]),
        downloaded_at=_timestamp(payload["downloaded_at"]),
        document=_document_from_payload(_mapping(payload["document"])),
        api_metadata=metadata,
        reference=SettlementReportReference(
            report_id=_string(payload["report_id"]),
            report_document_id=_string(payload["report_document_id"]),
            report_created_at=_timestamp(payload["report_created_at"]),
            marketplace_ids=tuple(_string(item) for item in _sequence(payload["marketplace_ids"])),
            report_data_start_at=_optional_timestamp(metadata.get("dataStartTime")),
            report_data_end_at=_optional_timestamp(metadata.get("dataEndTime")),
            api_metadata=metadata,
        ),
    )


def data_kiosk_from_payload(payload: Mapping[str, object]) -> DataKioskAcquisition:
    marketplace_ids = _sequence(payload["marketplace_ids"])
    if len(marketplace_ids) != 1:
        raise ValueError("A Data Kiosk acquisition must have one marketplace scope.")
    return DataKioskAcquisition(
        id=_identifier(payload["id"]),
        seller_namespace=_string(payload["seller_namespace"]),
        amazon_scope=_string(payload["amazon_scope"]),
        downloaded_at=_timestamp(payload["downloaded_at"]),
        root_query_id=_string(payload["root_query_id"]),
        root_query_created_at=_timestamp(payload["root_query_created_at"]),
        query_definition=_string(payload["query_definition"]),
        schema_version=_string(payload["schema_version"]),
        marketplace_id=_string(marketplace_ids[0]),
        query_start_date=_calendar_date(payload["query_start_date"]),
        query_end_date=_calendar_date(payload["query_end_date"]),
        pages=tuple(_page_from_payload(_mapping(item)) for item in _sequence(payload["documents"])),
        api_metadata=_mapping(payload["api_metadata"]),
    )


def _document_from_payload(payload: Mapping[str, object]) -> ArchivedDocument:
    return ArchivedDocument(
        bucket=_string(payload["bucket"]),
        object_path=_string(payload["object_path"]),
        document_sha256=_string(payload["document_sha256"]),
        document_byte_length=_integer(payload["document_byte_length"]),
        archive_sha256=_string(payload["archive_sha256"]),
        archive_byte_length=_integer(payload["archive_byte_length"]),
        source_compression=_optional_string(payload["source_compression"]),
        archive_codec=_string(payload["archive_codec"]),
        archive_preset=_string(payload["archive_preset"]),
        archive_check=_string(payload["archive_check"]),
    )


def _page_from_payload(payload: Mapping[str, object]) -> ArchivedDataKioskPage:
    terminal = payload["is_terminal"]
    if type(terminal) is not bool:
        raise TypeError("Acquisition terminal flags must be boolean.")
    return ArchivedDataKioskPage(
        page_number=_integer(payload["page_number"]),
        query_id=_string(payload["query_id"]),
        query_created_at=_timestamp(payload["query_created_at"]),
        document_kind=DataKioskDocumentKind(_string(payload["document_kind"])),
        is_terminal=terminal,
        document_id=_optional_string(payload["document_id"]),
        document=_document_from_payload(_mapping(payload["document"]))
        if payload["document"] is not None
        else None,
        api_metadata=_mapping(payload["api_metadata"]),
    )


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError("Manifest value must be an object.")
    return cast(Mapping[str, object], value)


def _sequence(value: object) -> tuple[object, ...] | list[object]:
    if not isinstance(value, list | tuple):
        raise TypeError("Manifest inventory must be an array.")
    return cast(tuple[object, ...] | list[object], value)


def _timestamp(value: object) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(_string(value))


def _optional_timestamp(value: object) -> datetime | None:
    return None if value is None else _timestamp(value)


def _calendar_date(value: object) -> date:
    return value if type(value) is date else date.fromisoformat(_string(value))


def _identifier(value: object) -> UUID:
    return value if isinstance(value, UUID) else UUID(_string(value))


def _string(value: object) -> str:
    """Decode text without inventing values or changing exact source identifiers."""
    if not isinstance(value, str):
        raise TypeError("Manifest text values must be strings.")
    return value


def _integer(value: object) -> int:
    if type(value) is not int:
        raise TypeError("Manifest length or page number must be an integer.")
    return value


def _optional_string(value: object) -> str | None:
    return None if value is None else _string(value)
