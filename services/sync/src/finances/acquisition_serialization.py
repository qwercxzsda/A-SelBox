"""Lossless JSON manifests for Finances archive publication and offline loading."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import cast
from uuid import UUID

from ..archives.serialization import document_from_payload
from ..source_serialization import source_mapping
from .acquisition_models import ArchivedFinancesPage, FinancesAcquisition


def finances_acquisition_payload(acquisition: FinancesAcquisition) -> dict[str, object]:
    return source_mapping(acquisition)


def finances_acquisition_from_payload(payload: Mapping[str, object]) -> FinancesAcquisition:
    identifier = payload["id"]
    return FinancesAcquisition(
        id=identifier if isinstance(identifier, UUID) else UUID(_text(identifier)),
        seller_namespace=_text(payload["seller_namespace"]),
        amazon_scope=_text(payload["amazon_scope"]),
        api_version=_text(payload["api_version"]),
        capture_started_at=_timestamp(payload["capture_started_at"]),
        downloaded_at=_timestamp(payload["downloaded_at"]),
        query_start_date=_date(payload["query_start_date"]),
        query_end_date=_date(payload["query_end_date"]),
        marketplace_ids=tuple(_text(value) for value in _sequence(payload["marketplace_ids"])),
        documents=tuple(_page(_mapping(value)) for value in _sequence(payload["documents"])),
        api_metadata=_mapping(payload["api_metadata"]),
    )


def _page(payload: Mapping[str, object]) -> ArchivedFinancesPage:
    operation = _text(payload["operation"])
    if operation not in ("transactions", "summary"):
        raise ValueError("Unknown archived Finances operation.")
    page_number, terminal = payload["page_number"], payload["is_terminal"]
    if type(page_number) is not int or type(terminal) is not bool:
        raise TypeError("Finances page number and terminal flag have invalid types.")
    return ArchivedFinancesPage(
        operation=operation,
        page_number=page_number,
        marketplace_id=None
        if payload["marketplace_id"] is None
        else _text(payload["marketplace_id"]),
        is_terminal=terminal,
        request_parameters={
            key: _text(value) for key, value in _mapping(payload["request_parameters"]).items()
        },
        requested_at=_timestamp(payload["requested_at"]),
        received_at=_timestamp(payload["received_at"]),
        document=document_from_payload(_mapping(payload["document"])),
        api_metadata=_mapping(payload["api_metadata"]),
    )


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError("Finances manifest requires an object.")
    return cast(Mapping[str, object], value)


def _sequence(value: object) -> list[object] | tuple[object, ...]:
    if not isinstance(value, list | tuple):
        raise TypeError("Finances manifest inventory must be an array.")
    return cast(list[object] | tuple[object, ...], value)


def _text(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("Finances manifest text must be a string.")
    return value


def _timestamp(value: object) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(_text(value))


def _date(value: object) -> date:
    return value if type(value) is date else date.fromisoformat(_text(value))
