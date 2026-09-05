import re
from collections.abc import Callable
from math import isfinite
from urllib.parse import urlsplit

import httpx

from .transport import suppress_sensitive_transport_logging

PRESIGNED_DOWNLOAD_TIMEOUT_SECONDS: float = 120.0

_S3_DOCUMENT_HOST = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9.-]{0,221}[a-z0-9])?\.)?"
    r"s3(?:-external-1|-[a-z0-9-]+|\.[a-z0-9-]+|\.dualstack\.[a-z0-9-]+)?"
    r"\.amazonaws\.com$"
)
_CLOUDFRONT_DOCUMENT_HOST = re.compile(r"^d[a-z0-9]{7,62}\.cloudfront\.net$")


def download_presigned_bytes[DownloadError: Exception](
    document_url: str,
    *,
    resource_name: str,
    error_factory: Callable[[str], DownloadError],
    timeout_seconds: float = PRESIGNED_DOWNLOAD_TIMEOUT_SECONDS,
    transport: httpx.BaseTransport | None = None,
) -> bytes:
    """Fetch exact bytes once from an HTTPS Amazon document host."""
    if not resource_name.strip():
        raise ValueError("resource_name must not be empty.")
    if (
        type(timeout_seconds) not in (int, float)
        or timeout_seconds <= 0
        or not isfinite(timeout_seconds)
    ):
        raise ValueError("timeout_seconds must be finite and positive.")

    suppress_sensitive_transport_logging()
    content, error_message = _download_once(
        document_url,
        resource_name=resource_name,
        timeout_seconds=timeout_seconds,
        transport=transport,
    )

    # Raise only after URL parsing and HTTPX frames have exited so transport
    # details are not retained as exception context.
    if error_message is not None:
        raise error_factory(error_message)
    if content is None:
        raise error_factory(f"{resource_name} download returned no content.")
    return content


def _download_once(
    document_url: str,
    *,
    resource_name: str,
    timeout_seconds: float,
    transport: httpx.BaseTransport | None,
) -> tuple[bytes | None, str | None]:
    if not _is_allowed_document_url(document_url):
        return None, f"{resource_name} download URL is invalid or unsafe."

    content: bytes | None = None
    try:
        with (
            httpx.Client(
                follow_redirects=False,
                timeout=timeout_seconds,
                transport=transport,
                trust_env=False,
            ) as http_client,
            http_client.stream(
                "GET",
                document_url,
                headers={"Accept-Encoding": "identity"},
                follow_redirects=False,
            ) as response,
        ):
            response_status = response.status_code
            if 200 <= response_status < 300:
                content = b"".join(response.iter_raw())
    except Exception:
        return None, f"{resource_name} download failed at the HTTP transport boundary."
    if 300 <= response_status < 400:
        return None, f"{resource_name} download returned a redirect."
    if not 200 <= response_status < 300:
        return None, f"{resource_name} download returned HTTP status {response_status}."
    return content, None


def _is_allowed_document_url(document_url: str) -> bool:
    try:
        parsed_url = urlsplit(document_url)
        port = parsed_url.port
    except ValueError:
        return False

    hostname = parsed_url.hostname
    return bool(
        document_url
        and parsed_url.scheme == "https"
        and hostname is not None
        and parsed_url.username is None
        and parsed_url.password is None
        and port in (None, 443)
        and _is_allowed_document_host(hostname)
    )


def _is_allowed_document_host(hostname: str) -> bool:
    return (
        _S3_DOCUMENT_HOST.fullmatch(hostname) is not None
        or _CLOUDFRONT_DOCUMENT_HOST.fullmatch(hostname) is not None
    )


__all__ = [
    "PRESIGNED_DOWNLOAD_TIMEOUT_SECONDS",
    "download_presigned_bytes",
]
