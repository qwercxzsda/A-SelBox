"""Tests for the bounded Amazon presigned-document HTTP boundary."""

import gzip
import unittest
from collections.abc import Callable
from functools import partial

import httpx

from ....src.amazon.presigned_downloads import download_presigned_bytes

_CLOUDFRONT_HOST = "d34o8swod1owfl.cloudfront.net"
_CLOUDFRONT_URL = f"https://{_CLOUDFRONT_HOST}/document?token=private-value"


class _DownloadError(RuntimeError):
    """Stable test domain error."""


def _recording_response(
    request: httpx.Request,
    *,
    requests: list[httpx.Request],
    status_code: int = 200,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    requests.append(request)
    return httpx.Response(
        status_code,
        headers=headers,
        stream=httpx.ByteStream(b"exact document"),
    )


class TestPresignedDownloads(unittest.TestCase):
    def test_accepts_observed_amazon_document_hosts(self) -> None:
        hosts = (
            "tortuga-prod-na.s3-external-1.amazonaws.com",
            "tortuga-prod-eu.s3-eu-west-1.amazonaws.com",
            "tortuga-prod-fe.s3-ap-northeast-1.amazonaws.com",
            "document-bucket.s3.ap-southeast-2.amazonaws.com",
            "s3.amazonaws.com",
            _CLOUDFRONT_HOST,
        )

        for host in hosts:
            with self.subTest(host=host):
                requests: list[httpx.Request] = []

                content = self._download(
                    f"https://{host}/document?token=private-value",
                    handler=partial(_recording_response, requests=requests),
                )

                self.assertEqual(content, b"exact document")
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0].url.host, host)
                self.assertEqual(requests[0].headers["accept-encoding"], "identity")

    def test_preserves_exact_wire_bytes_without_content_decoding(self) -> None:
        compressed = gzip.compress(b"document requiring exact retention")

        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"Content-Encoding": "gzip"},
                stream=httpx.ByteStream(compressed),
            )

        self.assertEqual(self._download(_CLOUDFRONT_URL, handler=handler), compressed)

    def test_preserves_signed_raw_path_query_and_explicit_https_port(self) -> None:
        raw_path = (
            b"/SampleResult%2BKey%3Dprivate%2Fvalue"
            b"?X-Amz-Credential=private%2F20260829%2Fus-east-1%2Fs3%2Faws4_request"
            b"&X-Amz-Signature=private-signature"
        )
        observed_requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            observed_requests.append(request)
            return httpx.Response(200, stream=httpx.ByteStream(b"document"))

        content = self._download(
            f"https://{_CLOUDFRONT_HOST}:443{raw_path.decode('ascii')}",
            handler=handler,
        )

        self.assertEqual(content, b"document")
        self.assertEqual(observed_requests[0].url.raw_path, raw_path)
        self.assertEqual(observed_requests[0].headers["host"], _CLOUDFRONT_HOST)

    def test_rejects_non_amazon_hosts_and_ip_literals_before_http(self) -> None:
        urls = (
            "https://127.0.0.1/private",
            "https://[::1]/private",
            "https://localhost/private",
            "https://metadata.google.internal/private",
            "https://cloudfront.net/private",
            "https://example.com/private",
        )

        for url in urls:
            with self.subTest(url=url), self.assertRaises(_DownloadError) as raised:
                download_presigned_bytes(
                    url,
                    resource_name="Test document",
                    error_factory=_DownloadError,
                    transport=self._unexpected_transport(),
                )

            self.assertNotIn(url, str(raised.exception))

    def test_rejects_invalid_scheme_port_userinfo_and_malformed_urls(self) -> None:
        urls = (
            f"https://user@{_CLOUDFRONT_HOST}/document",
            f"https://user:password@{_CLOUDFRONT_HOST}/document",
            f"https://{_CLOUDFRONT_HOST}:444/document",
            f"https://{_CLOUDFRONT_HOST}:/document",
            f"https://{_CLOUDFRONT_HOST}:not-a-port/document",
            f"http://{_CLOUDFRONT_HOST}/document",
            "not a URL",
            "https://[::1",
            "",
        )

        for url in urls:
            with self.subTest(url=url), self.assertRaises(_DownloadError) as raised:
                download_presigned_bytes(
                    url,
                    resource_name="Test document",
                    error_factory=_DownloadError,
                    transport=self._unexpected_transport(),
                )

            self.assertNotIn("private-value", str(raised.exception))

    def test_rejects_redirects_without_following_them(self) -> None:
        for status_code in (301, 302, 303, 307, 308):
            with self.subTest(status_code=status_code):
                requests: list[httpx.Request] = []

                with self.assertRaisesRegex(_DownloadError, "returned a redirect") as raised:
                    self._download(
                        _CLOUDFRONT_URL,
                        handler=partial(
                            _recording_response,
                            requests=requests,
                            status_code=status_code,
                            headers={"Location": "/private?secret=value"},
                        ),
                    )

                self.assertEqual(len(requests), 1)
                self.assertNotIn("secret", repr(raised.exception))
                self.assertIsNone(raised.exception.__context__)

    def test_transport_and_http_failures_are_unchained_and_redacted(self) -> None:
        def failing_handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError(
                f"private transport failure at {request.url}",
                request=request,
            )

        with self.assertRaises(_DownloadError) as transport_raised:
            self._download(_CLOUDFRONT_URL, handler=failing_handler)

        transport_error = repr(transport_raised.exception)
        self.assertIn("HTTP transport boundary", transport_error)
        self.assertNotIn("private-value", transport_error)
        self.assertNotIn(_CLOUDFRONT_HOST, transport_error)
        self.assertIsNone(transport_raised.exception.__context__)

        def forbidden_handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, content=b"private response body")

        with self.assertRaises(_DownloadError) as status_raised:
            self._download(_CLOUDFRONT_URL, handler=forbidden_handler)

        status_error = repr(status_raised.exception)
        self.assertIn("HTTP status 403", status_error)
        self.assertNotIn("private", status_error)
        self.assertNotIn(_CLOUDFRONT_HOST, status_error)
        self.assertIsNone(status_raised.exception.__context__)

    def test_validates_local_configuration_before_http(self) -> None:
        invalid_arguments: tuple[tuple[str, float], ...] = (
            ("", 1.0),
            ("Test document", 0.0),
            ("Test document", float("inf")),
        )

        for resource_name, timeout_seconds in invalid_arguments:
            with (
                self.subTest(resource_name=resource_name, timeout_seconds=timeout_seconds),
                self.assertRaises(ValueError),
            ):
                download_presigned_bytes(
                    _CLOUDFRONT_URL,
                    resource_name=resource_name,
                    error_factory=_DownloadError,
                    timeout_seconds=timeout_seconds,
                    transport=self._unexpected_transport(),
                )

    def _download(
        self,
        url: str,
        *,
        handler: Callable[[httpx.Request], httpx.Response],
    ) -> bytes:
        return download_presigned_bytes(
            url,
            resource_name="Test document",
            error_factory=_DownloadError,
            transport=httpx.MockTransport(handler),
        )

    @staticmethod
    def _unexpected_transport() -> httpx.BaseTransport:
        def handler(_request: httpx.Request) -> httpx.Response:
            raise AssertionError("The HTTP transport must not be used.")

        return httpx.MockTransport(handler)
