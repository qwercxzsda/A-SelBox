"""SP-API-only acquisition of exact Data Kiosk document bytes."""

import time
from collections.abc import Callable

from ..presigned_downloads import download_presigned_bytes
from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sanitized_throttled_api_call,
    suppress_sensitive_transport_logging,
)
from .client_protocol import DataKioskClient
from .errors import DataKioskDocumentError, DataKioskResponseError
from .responses import get_payload, require_matching_text, required_text


def download_document(
    client: DataKioskClient,
    document_id: str,
    *,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> bytes:
    """Return the exact transferred body without decoding or parsing it."""
    if not document_id or document_id != document_id.strip():
        raise ValueError("document_id must not be empty.")

    suppress_sensitive_transport_logging()
    response = sanitized_throttled_api_call(
        lambda: client.get_document(document_id),
        safe_error=DataKioskResponseError("Data Kiosk document metadata request failed."),
        max_attempts=max_throttle_attempts,
        retry_delay_seconds=throttle_retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
        sleep=sleep,
    )
    payload = get_payload(response, "getDocument")
    require_matching_text(payload, "documentId", document_id, "getDocument")
    document_url = required_text(payload, "documentUrl", "getDocument")
    return download_presigned_bytes(
        document_url,
        resource_name="Data Kiosk document",
        error_factory=DataKioskDocumentError,
    )


__all__ = ["download_document"]
