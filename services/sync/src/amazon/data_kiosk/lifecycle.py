import math
import time
from collections.abc import Callable, Mapping

from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sanitized_throttled_api_call,
)
from .client_protocol import DataKioskClient, DataKioskResponse
from .errors import (
    DataKioskPollingTimeoutError,
    DataKioskQueryFailedError,
    DataKioskResponseError,
)
from .models import CompletedDataKioskQuery, DataKioskDocumentKind
from .query_builder import canonicalize_graphql_query
from .responses import (
    FAILED_STATUSES,
    IN_PROGRESS_STATUSES,
    TERMINAL_STATUS,
    extract_done_document_ids,
    extract_pagination_token,
    get_payload,
    optional_text,
    require_matching_text,
    required_text,
)

DEFAULT_MAX_POLL_ATTEMPTS: int = 60
DEFAULT_POLL_INTERVAL_SECONDS: float = 10.0


def extract_query_id(response: DataKioskResponse) -> str:
    """Extract the required query ID from a createQuery response."""
    query_id = required_text(get_payload(response, "createQuery"), "queryId", "createQuery")
    if query_id != query_id.strip():
        raise DataKioskResponseError("createQuery response has an invalid field queryId.")
    return query_id


def submit_query(
    client: DataKioskClient,
    query: str,
    pagination_token: str | None = None,
    *,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Submit a query, retrying only explicit bounded createQuery throttles."""
    if not query.strip():
        raise ValueError("query must not be empty.")
    if pagination_token is not None and (
        not pagination_token or pagination_token != pagination_token.strip()
    ):
        raise ValueError("pagination_token must be non-empty when provided.")

    response = sanitized_throttled_api_call(
        lambda: (
            client.create_query(query)
            if pagination_token is None
            else client.create_query(query, pagination_token=pagination_token)
        ),
        safe_error=DataKioskResponseError("Data Kiosk query submission failed."),
        max_attempts=max_throttle_attempts,
        retry_delay_seconds=throttle_retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
        sleep=sleep,
    )
    return extract_query_id(response)


def poll_query_until_complete(
    client: DataKioskClient,
    query_id: str,
    *,
    expected_query: str,
    max_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> CompletedDataKioskQuery:
    """Poll a query to DONE with explicit attempt and sleep bounds."""
    _validate_poll_arguments(
        query_id,
        expected_query,
        max_attempts,
        poll_interval_seconds,
    )
    for attempt in range(max_attempts):
        response = sanitized_throttled_api_call(
            lambda: client.get_query(query_id),
            safe_error=DataKioskResponseError(
                "Data Kiosk query status request failed.",
                diagnostic_code="DATA_KIOSK_GET_QUERY_REQUEST_FAILED",
            ),
            max_attempts=max_throttle_attempts,
            retry_delay_seconds=throttle_retry_delay_seconds,
            max_retry_after_seconds=max_retry_after_seconds,
            sleep=sleep,
        )
        payload = get_payload(response, "getQuery")
        require_matching_text(payload, "queryId", query_id, "getQuery")
        _require_matching_query(payload, expected_query)
        processing_status = required_text(payload, "processingStatus", "getQuery")

        if processing_status == TERMINAL_STATUS:
            return _completed_query(query_id, payload)
        if processing_status in FAILED_STATUSES:
            raise DataKioskQueryFailedError(
                query_id=query_id,
                processing_status=processing_status,
                error_document_id=optional_text(payload, "errorDocumentId", "getQuery"),
            )
        if processing_status not in IN_PROGRESS_STATUSES:
            raise DataKioskResponseError("getQuery returned an unsupported processingStatus value.")
        if attempt + 1 < max_attempts:
            sleep(poll_interval_seconds)

    raise DataKioskPollingTimeoutError(
        f"Data Kiosk query did not finish within {max_attempts} poll attempts."
    )


def _require_matching_query(payload: Mapping[str, object], expected_query: str) -> None:
    returned_query = required_text(payload, "query", "getQuery")
    if canonicalize_graphql_query(returned_query) != canonicalize_graphql_query(expected_query):
        raise DataKioskResponseError("getQuery response query did not match the request.")


def _validate_poll_arguments(
    query_id: str,
    expected_query: str,
    max_attempts: int,
    poll_interval_seconds: float,
) -> None:
    if not query_id or query_id != query_id.strip():
        raise ValueError("query_id must not be empty.")
    if not expected_query.strip():
        raise ValueError("expected_query must not be empty.")
    if type(max_attempts) is not int or max_attempts < 1:
        raise ValueError("max_attempts must be greater than or equal to 1.")
    if (
        type(poll_interval_seconds) not in (int, float)
        or poll_interval_seconds < 0
        or not math.isfinite(poll_interval_seconds)
    ):
        raise ValueError("poll_interval_seconds must be finite and non-negative.")


def _completed_query(
    query_id: str,
    payload: Mapping[str, object],
) -> CompletedDataKioskQuery:
    data_document_id, error_document_id = extract_done_document_ids(payload)
    if data_document_id is not None:
        document_kind = DataKioskDocumentKind.DATA
    elif error_document_id is not None:
        document_kind = DataKioskDocumentKind.ERROR
    else:
        document_kind = DataKioskDocumentKind.NO_DATA
    return CompletedDataKioskQuery(
        query_id=query_id,
        document_kind=document_kind,
        data_document_id=data_document_id,
        error_document_id=error_document_id,
        next_pagination_token=extract_pagination_token(payload, "getQuery"),
    )


__all__ = [
    "DEFAULT_MAX_POLL_ATTEMPTS",
    "DEFAULT_POLL_INTERVAL_SECONDS",
    "extract_query_id",
    "poll_query_until_complete",
    "submit_query",
]
