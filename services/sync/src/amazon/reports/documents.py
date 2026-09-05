import time
from collections.abc import Callable, Mapping
from typing import cast

from ..presigned_downloads import (
    PRESIGNED_DOWNLOAD_TIMEOUT_SECONDS,
    download_presigned_bytes,
)
from ..transport import (
    DEFAULT_THROTTLE_MAX_ATTEMPTS,
    DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sanitized_throttled_api_call,
    suppress_sensitive_transport_logging,
)
from .errors import ReportDocumentDownloadError
from .models import (
    DownloadedReportDocument,
    ReportDocumentCompression,
    normalize_report_document_compression,
)
from .sdk_types import (
    ReportDocumentClient,
    ReportDocumentMetadata,
)


def download_report_document(
    client: ReportDocumentClient,
    report_document_id: str,
    *,
    max_throttle_attempts: int = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    throttle_retry_delay_seconds: float = DEFAULT_THROTTLE_RETRY_DELAY_SECONDS,
    max_retry_after_seconds: int = MAX_THROTTLE_RETRY_AFTER_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> DownloadedReportDocument:
    """Return the exact transferred body and its explicit compression fact."""
    if not report_document_id or report_document_id != report_document_id.strip():
        raise ValueError("report_document_id must not be empty.")
    suppress_sensitive_transport_logging()
    payload = _get_document_metadata(
        client,
        report_document_id,
        max_throttle_attempts=max_throttle_attempts,
        throttle_retry_delay_seconds=throttle_retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
        sleep=sleep,
    )
    document_url, compression_algorithm = _document_location(payload)
    downloaded_content = download_presigned_report_bytes(document_url)
    return DownloadedReportDocument(
        transferred_content=downloaded_content,
        compression_algorithm=compression_algorithm,
    )


def _get_document_metadata(
    client: ReportDocumentClient,
    report_document_id: str,
    *,
    max_throttle_attempts: int,
    throttle_retry_delay_seconds: float,
    max_retry_after_seconds: int,
    sleep: Callable[[float], None],
) -> ReportDocumentMetadata:
    response = sanitized_throttled_api_call(
        lambda: client.get_report_document(report_document_id),
        safe_error=ReportDocumentDownloadError(
            "Reports API report-document metadata request failed."
        ),
        max_attempts=max_throttle_attempts,
        retry_delay_seconds=throttle_retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
        sleep=sleep,
    )
    payload: object = getattr(response, "payload", None)
    if not isinstance(payload, Mapping):
        raise ReportDocumentDownloadError(
            "Reports API returned an invalid report-document payload."
        )
    metadata = cast(ReportDocumentMetadata, payload)
    returned_document_id = metadata.get("reportDocumentId")
    if returned_document_id != report_document_id:
        raise ReportDocumentDownloadError(
            "Reports API report-document response did not match the requested document."
        )
    return metadata


def _document_location(
    payload: Mapping[str, object],
) -> tuple[str, ReportDocumentCompression]:
    document_url: object = payload.get("url")
    if not isinstance(document_url, str) or not document_url.strip():
        raise ReportDocumentDownloadError("Reports API report-document payload is missing its URL.")
    compression_algorithm: object = payload.get("compressionAlgorithm")
    try:
        retained_declaration = normalize_report_document_compression(compression_algorithm)
    except TypeError, ValueError:
        raise ReportDocumentDownloadError(
            "Reports API returned an invalid compression declaration."
        ) from None
    return document_url, retained_declaration


def download_presigned_report_bytes(document_url: str) -> bytes:
    """Fetch exact bytes with explicit HTTP status and sanitized failure handling.

    The SDK's ``download=True`` convenience path does not enforce the status and
    decoding guarantees required by lossless report parsing, so this boundary
    deliberately owns the signed transfer.
    """
    return download_presigned_bytes(
        document_url,
        resource_name="Report document",
        error_factory=ReportDocumentDownloadError,
        timeout_seconds=PRESIGNED_DOWNLOAD_TIMEOUT_SECONDS,
    )


__all__ = [
    "download_presigned_report_bytes",
    "download_report_document",
]
