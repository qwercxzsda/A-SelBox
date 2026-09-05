"""Tests for exact Settlement report acquisition and later decoding."""

import gzip
import unittest
from unittest.mock import patch

import httpx
from sp_api.base import SellingApiException, SellingApiRequestThrottledException

from ....src.amazon import presigned_downloads
from ....src.amazon.reports import documents as amazon_report_documents
from ....src.amazon.reports.decoding import decompress_report_document
from ....src.amazon.reports.documents import download_report_document
from ....src.amazon.reports.errors import (
    ReportDocumentDecompressionError,
    ReportDocumentDownloadError,
)
from ....src.amazon.reports.models import DownloadedReportDocument
from ...support.settlement_reports import (
    FakeClient,
    FakeResponse,
    make_report_text,
)

_REPORT_DOCUMENT_HOST = "d34o8swod1owfl.cloudfront.net"


def _throttled(retry_after: str = "1") -> SellingApiRequestThrottledException:
    return SellingApiRequestThrottledException(
        [{"code": "QuotaExceeded", "message": "private request context"}],
        headers={"Retry-After": retry_after},
    )


class TestSettlementReportDocuments(unittest.TestCase):
    def test_download_retains_exact_gzip_transfer_without_decompressing(self) -> None:
        """Keep malformed compressed bytes because decoding belongs to processing."""
        client = FakeClient(make_report_text())
        transferred_content = b"not-valid-gzip-but-exactly-transferred"

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "GZIP",
                    },
                    None,
                ),
            ),
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=transferred_content,
            ),
        ):
            downloaded = download_report_document(client, "document-1")

        self.assertEqual(
            downloaded,
            DownloadedReportDocument(
                transferred_content=transferred_content,
                compression_algorithm="GZIP",
            ),
        )

    def test_metadata_retries_explicit_429_and_honors_retry_after(self) -> None:
        """Repeat only the safe metadata request after one observed throttle."""
        client = FakeClient(make_report_text())
        sleeps: list[float] = []

        with (
            patch.object(
                client,
                "get_report_document",
                side_effect=[
                    _throttled("7"),
                    FakeResponse(
                        {
                            "reportDocumentId": "document-1",
                            "url": "https://download.invalid/document-1",
                        },
                        None,
                    ),
                ],
            ) as metadata,
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=b"report bytes",
            ),
        ):
            actual = download_report_document(
                client,
                "document-1",
                sleep=sleeps.append,
            )

        self.assertEqual(actual.transferred_content, b"report bytes")
        self.assertEqual(metadata.call_count, 2)
        self.assertEqual(sleeps, [7.0])

    def test_metadata_stops_after_three_bounded_throttle_attempts(self) -> None:
        """Reject an over-cap Retry-After and retain the three-attempt bound."""
        client = FakeClient(make_report_text())
        sleeps: list[float] = []

        with (
            patch.object(
                client,
                "get_report_document",
                side_effect=[_throttled("301") for _ in range(3)],
            ) as metadata,
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
            ) as download,
            self.assertRaises(ReportDocumentDownloadError) as raised,
        ):
            download_report_document(
                client,
                "document-1",
                sleep=sleeps.append,
            )

        self.assertEqual(metadata.call_count, 3)
        self.assertEqual(sleeps, [60.0, 60.0])
        self.assertIsNone(raised.exception.__context__)
        download.assert_not_called()

    def test_metadata_does_not_retry_permanent_sdk_failure(self) -> None:
        """Sanitize a non-429 SDK failure after one metadata request."""
        client = FakeClient(make_report_text())
        private_context = "private report metadata context"
        headers: dict[str, str] = {}
        sleeps: list[float] = []

        with (
            patch.object(
                client,
                "get_report_document",
                side_effect=SellingApiException(
                    [{"code": "Unauthorized", "message": private_context}],
                    headers=headers,
                ),
            ) as metadata,
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
            ) as download,
            self.assertRaises(ReportDocumentDownloadError) as raised,
        ):
            download_report_document(
                client,
                "document-1",
                sleep=sleeps.append,
            )

        self.assertEqual(metadata.call_count, 1)
        self.assertEqual(sleeps, [])
        self.assertNotIn(private_context, repr(raised.exception))
        self.assertIsNone(raised.exception.__context__)
        download.assert_not_called()

    def test_document_metadata_must_echo_the_requested_id(self) -> None:
        """Check report metadata cannot substitute a different document."""
        requested_id = "private-requested-document-id"
        returned_id = "private-returned-document-id"
        client = FakeClient(make_report_text())

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": returned_id,
                        "url": "https://download.invalid/private",
                    },
                    None,
                ),
            ),
            patch.object(amazon_report_documents, "download_presigned_report_bytes") as download,
        ):
            with self.assertRaises(ReportDocumentDownloadError) as raised:
                download_report_document(client, requested_id)

            download.assert_not_called()

        error_text = str(raised.exception)
        self.assertIn("did not match", error_text)
        self.assertNotIn(requested_id, error_text)
        self.assertNotIn(returned_id, error_text)

    def test_document_http_error_never_writes_or_exposes_signed_url(self) -> None:
        """Check that an HTTP error body cannot become durable parsed content."""
        client = FakeClient(make_report_text())
        signed_url = f"https://{_REPORT_DOCUMENT_HOST}/document-1?token=private-value"
        response = httpx.Response(
            403,
            content=b"<Error>expired signature</Error>",
            request=httpx.Request("GET", signed_url),
        )

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {"reportDocumentId": "document-1", "url": signed_url},
                    None,
                ),
            ),
            patch.object(presigned_downloads.httpx, "Client") as http_client_class,
        ):
            http_client = http_client_class.return_value.__enter__.return_value
            http_client.stream.return_value.__enter__.return_value = response

            with self.assertRaises(ReportDocumentDownloadError) as raised:
                download_report_document(client, "document-1")

        error_text = repr(raised.exception)
        self.assertIn("HTTP status 403", error_text)
        self.assertNotIn(_REPORT_DOCUMENT_HOST, error_text)
        self.assertNotIn("private-value", error_text)
        self.assertIsNone(raised.exception.__context__)

    def test_invalid_document_url_is_sanitized_and_isolated(self) -> None:
        """Check malformed signed URLs become the downloader's safe error type."""
        client = FakeClient(make_report_text())
        signed_url = f"https://{_REPORT_DOCUMENT_HOST}/document-1?token=private-value"

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {"reportDocumentId": "document-1", "url": signed_url},
                    None,
                ),
            ),
            patch.object(presigned_downloads.httpx, "Client") as http_client_class,
        ):
            http_client = http_client_class.return_value.__enter__.return_value
            http_client.stream.side_effect = httpx.InvalidURL(signed_url)

            with self.assertRaises(ReportDocumentDownloadError) as raised:
                download_report_document(client, "document-1")

        error_text = repr(raised.exception)
        self.assertIn("HTTP transport boundary", error_text)
        self.assertNotIn(_REPORT_DOCUMENT_HOST, error_text)
        self.assertNotIn("private-value", error_text)

    def test_processing_decompresses_retained_gzip_to_exact_report_bytes(self) -> None:
        """Check that replacing the SDK downloader preserves report contents."""
        client = FakeClient(make_report_text())
        report_content = make_report_text().encode()

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "GZIP",
                    },
                    None,
                ),
            ),
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=gzip.compress(report_content),
            ),
        ):
            downloaded = download_report_document(client, "document-1")

            self.assertEqual(decompress_report_document(downloaded), report_content)

    def test_rejects_compression_outside_the_official_optional_gzip_enum(self) -> None:
        """Reject metadata outside Amazon's GZIP-or-absent contract."""
        client = FakeClient(make_report_text())

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "UNOBSERVED",
                    },
                    None,
                ),
            ),
            patch.object(amazon_report_documents, "download_presigned_report_bytes") as download,
            self.assertRaisesRegex(ReportDocumentDownloadError, "compression declaration"),
        ):
            amazon_report_documents.download_report_document(client, "document-1")

        download.assert_not_called()

    def test_document_download_preserves_every_gzip_member(self) -> None:
        """Check that concatenated GZIP members are not silently truncated."""
        client = FakeClient(make_report_text())
        first_member = b"first report fragment\n"
        second_member = b"second report fragment\n"

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "GZIP",
                    },
                    None,
                ),
            ),
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=gzip.compress(first_member) + gzip.compress(second_member),
            ),
        ):
            downloaded = download_report_document(client, "document-1")

            self.assertEqual(
                decompress_report_document(downloaded),
                first_member + second_member,
            )

    def test_processing_rejects_trailing_gzip_garbage(self) -> None:
        """Reject invalid trailing bytes only after acquisition has retained them."""
        client = FakeClient(make_report_text())

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "GZIP",
                    },
                    None,
                ),
            ),
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=gzip.compress(b"report") + b"not-a-gzip-member",
            ),
        ):
            downloaded = download_report_document(client, "document-1")
            with self.assertRaisesRegex(
                ReportDocumentDecompressionError,
                "not valid GZIP content",
            ):
                decompress_report_document(downloaded)


if __name__ == "__main__":
    unittest.main()
