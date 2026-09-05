from collections.abc import Mapping
from typing import cast

from .client_protocol import DataKioskResponse
from .errors import DataKioskResponseError

IN_PROGRESS_STATUSES: frozenset[str] = frozenset({"IN_QUEUE", "IN_PROGRESS"})
FAILED_STATUSES: frozenset[str] = frozenset({"CANCELLED", "FATAL"})
TERMINAL_STATUS: str = "DONE"


def get_payload(response: DataKioskResponse, operation: str) -> Mapping[str, object]:
    """Return a mapping payload from an otherwise untyped SDK response."""
    payload: object = getattr(response, "payload", None)
    if not isinstance(payload, Mapping):
        raise DataKioskResponseError(f"{operation} returned a non-object payload.")
    return cast(Mapping[str, object], payload)


def required_text(payload: Mapping[str, object], key: str, operation: str) -> str:
    """Read one required, non-empty string from an API payload."""
    value: object = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise DataKioskResponseError(f"{operation} response is missing required field {key}.")
    return value


def require_matching_text(
    payload: Mapping[str, object],
    key: str,
    requested_value: str,
    operation: str,
) -> str:
    """Require an echoed identifier to match without exposing either value."""
    returned_value = required_text(payload, key, operation)
    if returned_value != requested_value:
        raise DataKioskResponseError(f"{operation} response field {key} did not match the request.")
    return returned_value


def optional_text(
    payload: Mapping[str, object],
    key: str,
    operation: str,
) -> str | None:
    """Read one optional string while rejecting malformed present values."""
    value: object = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value or value != value.strip():
        raise DataKioskResponseError(f"{operation} response has an invalid field {key}.")
    return value


def extract_pagination_token(
    payload: Mapping[str, object],
    operation: str,
) -> str | None:
    """Extract Amazon's nested next-page token when present."""
    pagination: object = payload.get("pagination")
    if pagination is None:
        return None
    if not isinstance(pagination, Mapping):
        raise DataKioskResponseError(f"{operation} response has an invalid pagination field.")
    return optional_text(
        cast(Mapping[str, object], pagination),
        "nextToken",
        f"{operation} pagination",
    )


def extract_done_document_ids(
    query_payload: Mapping[str, object],
) -> tuple[str | None, str | None]:
    """Return mutually exclusive document IDs from a DONE query payload."""
    processing_status = required_text(query_payload, "processingStatus", "getQuery")
    if processing_status != TERMINAL_STATUS:
        raise DataKioskResponseError(
            "Document identifiers are available only when processingStatus is DONE."
        )

    data_document_id = optional_text(query_payload, "dataDocumentId", "getQuery")
    error_document_id = optional_text(query_payload, "errorDocumentId", "getQuery")
    if data_document_id is not None and error_document_id is not None:
        raise DataKioskResponseError(
            "The completed Data Kiosk query returned both data and error document identifiers."
        )
    return data_document_id, error_document_id
