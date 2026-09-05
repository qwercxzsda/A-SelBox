"""Tests for Data Kiosk document download and parsing."""

import gzip
import json
import unittest
from decimal import Decimal
from typing import cast
from unittest.mock import patch

import httpx
from sp_api.base import SellingApiRequestThrottledException

from ....src.amazon import presigned_downloads
from ....src.amazon.data_kiosk import (
    DataKioskDocumentError,
    DataKioskResponseError,
)
from ....src.amazon.data_kiosk.document_acquisition import download_document
from ....src.amazon.data_kiosk.document_processing import (
    parse_json_document,
    parse_jsonl_source_document,
)
from ....src.amazon.data_kiosk.lifecycle import submit_query
from ...support.data_kiosk import (
    FakeDataKioskClient,
    FakeResponse,
    fake_data_kiosk_downloads,
)

_REPORT_DOCUMENT_HOST = "d34o8swod1owfl.cloudfront.net"


class TestDataKioskDocuments(unittest.TestCase):
    def setUp(self) -> None:
        """Create equivalent plain and gzip JSONL fixtures."""
        self.rows: list[dict[str, object]] = [
            {"marketplaceId": "ATVPDKIKX0DER", "msku": "SKU-1"},
            {"marketplaceId": "ATVPDKIKX0DER", "msku": "SKU-2"},
        ]
        self.plain_document = (
            "\n".join(json.dumps(row, separators=(",", ":")) for row in self.rows) + "\n"
        ).encode()
        self.gzip_document = gzip.compress(self.plain_document)

    def test_download_document_uses_metadata_then_presigned_http_bytes(self) -> None:
        """Check getDocument stays in metadata mode before the signed transfer."""
        fake_client = FakeDataKioskClient(
            document_payload={
                "documentId": "document-1",
                "documentUrl": "https://temporary.example/secret-signed-url",
                "document": self.plain_document,
            }
        )

        with fake_data_kiosk_downloads(fake_client):
            document = download_document(fake_client, "document-1")

        self.assertEqual(document, self.plain_document)
        self.assertEqual(fake_client.document_calls, [("document-1", False)])

    def test_download_document_retries_explicit_metadata_throttle(self) -> None:
        """Repeat the safe metadata GET after one bounded explicit 429."""
        fake_client = FakeDataKioskClient()
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": "private metadata request"}],
            headers={"retry-after": "3"},
        )
        metadata = FakeResponse(
            {
                "documentId": "document-1",
                "documentUrl": "https://download.invalid/data-kiosk/1",
            }
        )
        sleep_calls: list[float] = []

        with (
            patch.object(
                fake_client, "get_document", side_effect=(throttled, metadata)
            ) as get_document,
            patch(
                "services.sync.src.amazon.data_kiosk.document_acquisition.download_presigned_bytes",
                return_value=self.plain_document,
            ),
        ):
            document = download_document(
                fake_client,
                "document-1",
                sleep=sleep_calls.append,
            )

        self.assertEqual(document, self.plain_document)
        self.assertEqual(get_document.call_count, 2)
        self.assertEqual(sleep_calls, [3.0])

    def test_document_http_error_never_exposes_signed_url(self) -> None:
        """Check signed URL failures become stable Data Kiosk document errors."""
        signed_url = f"https://{_REPORT_DOCUMENT_HOST}/document?token=private-value"
        fake_client = FakeDataKioskClient(
            document_payload={"documentId": "document-1", "documentUrl": signed_url}
        )
        response = httpx.Response(
            403,
            request=httpx.Request("GET", signed_url),
        )

        with patch.object(presigned_downloads.httpx, "Client") as http_client_class:
            http_client = http_client_class.return_value.__enter__.return_value
            http_client.stream.return_value.__enter__.return_value = response

            with self.assertRaises(DataKioskDocumentError) as raised:
                download_document(fake_client, "document-1")

        error_text = repr(raised.exception)
        self.assertIn("HTTP status 403", error_text)
        self.assertNotIn(_REPORT_DOCUMENT_HOST, error_text)
        self.assertNotIn("private-value", error_text)
        self.assertIsNone(raised.exception.__context__)

    def test_invalid_document_url_is_sanitized(self) -> None:
        """Check malformed signed URLs do not survive in the domain failure."""
        signed_url = f"https://{_REPORT_DOCUMENT_HOST}/document?token=private-value"
        fake_client = FakeDataKioskClient(
            document_payload={"documentId": "document-1", "documentUrl": signed_url}
        )

        with patch.object(presigned_downloads.httpx, "Client") as http_client_class:
            http_client = http_client_class.return_value.__enter__.return_value
            http_client.stream.side_effect = httpx.InvalidURL(signed_url)

            with self.assertRaises(DataKioskDocumentError) as raised:
                download_document(fake_client, "document-1")

        error_text = repr(raised.exception)
        self.assertIn("HTTP transport boundary", error_text)
        self.assertNotIn(_REPORT_DOCUMENT_HOST, error_text)
        self.assertNotIn("private-value", error_text)
        self.assertIsNone(raised.exception.__context__)

    def test_non_https_document_url_is_rejected_before_http(self) -> None:
        signed_url = f"http://{_REPORT_DOCUMENT_HOST}/document?token=private-value"
        fake_client = FakeDataKioskClient(
            document_payload={"documentId": "document-1", "documentUrl": signed_url}
        )

        with (
            patch.object(presigned_downloads.httpx, "Client") as http_client_class,
            self.assertRaises(DataKioskDocumentError) as raised,
        ):
            download_document(fake_client, "document-1")

        http_client_class.assert_not_called()
        self.assertNotIn(signed_url, str(raised.exception))

    def test_parses_equivalent_plain_and_gzip_jsonl(self) -> None:
        """Check transparent compression detection and JSON object parsing."""
        expected_rows = tuple(self.rows)

        plain = parse_jsonl_source_document(self.plain_document)
        compressed = parse_jsonl_source_document(self.gzip_document)

        self.assertEqual(tuple(row.value for row in plain.rows), expected_rows)
        self.assertEqual(tuple(row.value for row in compressed.rows), expected_rows)

    def test_rejects_malformed_gzip_without_retaining_decompression_context(self) -> None:
        """Invalid DEFLATE blocks use the same safe error as damaged gzip headers."""
        malformed_documents = (
            b"\x1f\x8btruncated-header",
            bytes.fromhex("1f8b0800000000000003ff"),
            gzip.compress(self.plain_document)[:-1],
        )
        for parser in (parse_json_document, parse_jsonl_source_document):
            for index, document in enumerate(malformed_documents):
                with (
                    self.subTest(parser=parser.__name__, case=index),
                    self.assertRaisesRegex(DataKioskDocumentError, "gzip.*invalid") as raised,
                ):
                    parser(document)

                self.assertIsNone(raised.exception.__context__)

    def test_parsed_jsonl_values_cannot_change_beneath_their_digest(self) -> None:
        """Keep top-level, nested-object, and array lineage immutable."""
        parsed = parse_jsonl_source_document(
            b'{"startDate":"2026-08-01","fees":[{"feeTypeName":"Storage"}]}\n'
        )
        decoded_sha256 = parsed.decoded_sha256
        row = parsed.rows[0].value

        with self.assertRaises(TypeError):
            cast(dict[str, object], row)["startDate"] = "2099-01-01"

        fees = cast(tuple[object, ...], row["fees"])
        self.assertIsInstance(fees, tuple)
        with self.assertRaises(AttributeError):
            cast(list[object], fees).append({"feeTypeName": "Changed"})

        fee = cast(dict[str, object], fees[0])
        with self.assertRaises(TypeError):
            fee["feeTypeName"] = "Changed"

        self.assertEqual(parsed.decoded_sha256, decoded_sha256)
        self.assertEqual(row["startDate"], "2026-08-01")
        self.assertEqual(cast(dict[str, object], fees[0])["feeTypeName"], "Storage")

    def test_unicode_string_separators_do_not_split_jsonl_source_rows(self) -> None:
        row = {"label": "first\u0085second\u2028third\u2029last"}
        row_text = json.dumps(row, ensure_ascii=False)
        for newline in ("\n", "\r\n", "\r"):
            with self.subTest(newline=repr(newline)):
                document = f"{newline}{row_text}{newline}{{}}{newline}".encode()

                parsed = parse_jsonl_source_document(document)

                self.assertEqual(tuple(item.value for item in parsed.rows), (row, {}))
                self.assertEqual(tuple(item.source_line_number for item in parsed.rows), (2, 3))

    def test_parses_every_json_number_directly_as_decimal(self) -> None:
        """Check money never passes through a binary floating-point value."""
        document = (
            b'{"amount":12345678901234567890.123456789012345678901,'
            b'"quantity":2,"nested":{"rate":0.000000000000000000001}}\n'
        )

        parsed_document = parse_jsonl_source_document(b"\n" + document)
        row = parsed_document.rows[0].value

        self.assertEqual(
            row["amount"],
            Decimal("12345678901234567890.123456789012345678901"),
        )
        self.assertEqual(row["quantity"], Decimal("2"))
        self.assertEqual(
            row["nested"],
            {"rate": Decimal("0.000000000000000000001")},
        )
        self.assertEqual(parsed_document.rows[0].source_line_number, 2)

    def test_rejects_nonstandard_nonfinite_json_numbers(self) -> None:
        """Check NaN and infinities cannot enter exact financial values."""
        with self.assertRaises(DataKioskDocumentError):
            parse_jsonl_source_document(b'{"amount":NaN}\n')

    def test_rejects_duplicate_json_keys_without_retaining_values(self) -> None:
        private_document = b'{"msku":"private-first","msku":"private-second"}\n'

        with self.assertRaises(DataKioskDocumentError) as raised:
            parse_jsonl_source_document(private_document)

        self.assertNotIn("private-first", str(raised.exception))
        self.assertNotIn("private-second", str(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_general_json_parser_accepts_every_valid_root_with_exact_numbers(self) -> None:
        """Validate opaque error JSON without assuming Amazon's root schema."""
        cases: tuple[tuple[bytes, object], ...] = (
            (
                b'{"amount":12345678901234567890.123456789012345678901}',
                {"amount": Decimal("12345678901234567890.123456789012345678901")},
            ),
            (b'[1,"private",null]', [Decimal("1"), "private", None]),
            (b'"private root"', "private root"),
            (b"true", True),
            (b"null", None),
        )

        for document, expected in cases:
            with self.subTest(document_type=type(expected).__name__):
                self.assertEqual(parse_json_document(document), expected)

        self.assertEqual(
            parse_json_document(gzip.compress(b"[2.000000000000000000001]")),
            [Decimal("2.000000000000000000001")],
        )

    def test_general_json_parser_rejects_duplicates_without_contents(self) -> None:
        """Duplicate fields fail closed without retaining either private value."""
        private_document = b'{"field":"private-first","field":"private-second"}'

        with self.assertRaises(DataKioskDocumentError) as raised:
            parse_json_document(private_document)

        error_text = repr(raised.exception)
        self.assertNotIn("private-first", error_text)
        self.assertNotIn("private-second", error_text)
        self.assertIsNone(raised.exception.__context__)

    def test_general_json_parser_rejects_invalid_utf8_and_nonstandard_numbers(self) -> None:
        """Opaque roots retain strict UTF-8 and JSON-number validation."""
        for private_document in (b'\xff"private"', b'{"private":NaN}'):
            with (
                self.subTest(private_document=private_document[:1]),
                self.assertRaises(DataKioskDocumentError) as raised,
            ):
                parse_json_document(private_document)

            self.assertNotIn("private", repr(raised.exception))
            self.assertIsNone(raised.exception.__context__)

    def test_invalid_json_error_does_not_echo_row_contents(self) -> None:
        """Check that parser failures identify only the source line number."""
        secret_row = b'{"secret":"customer-secret", invalid}\n'

        with self.assertRaises(DataKioskDocumentError) as raised:
            parse_jsonl_source_document(secret_row)

        self.assertIn("source line 1", str(raised.exception))
        self.assertNotIn("customer-secret", str(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_invalid_utf8_does_not_retain_private_document_bytes(self) -> None:
        private_document = b'\xff{"secret":"private-row"}'

        with self.assertRaises(DataKioskDocumentError) as raised:
            parse_jsonl_source_document(private_document)

        self.assertIsNone(raised.exception.__context__)

    def test_rejects_non_object_jsonl_rows(self) -> None:
        """Check that each Data Kiosk JSONL record is an object."""
        with self.assertRaisesRegex(DataKioskDocumentError, "not a JSON object"):
            parse_jsonl_source_document(b'["not", "an", "object"]\n')

    def test_rejects_document_metadata_without_url(self) -> None:
        """Check malformed getDocument metadata fails before any HTTP request."""
        fake_client = FakeDataKioskClient(document_payload={"documentId": "document-1"})

        with self.assertRaises(DataKioskResponseError):
            download_document(fake_client, "document-1")

    def test_rejects_mismatched_document_id_without_exposing_ids(self) -> None:
        """Check getDocument cannot redirect one requested identity to another."""
        requested_id = "private-requested-document-id"
        returned_id = "private-returned-document-id"
        fake_client = FakeDataKioskClient(
            document_payload={
                "documentId": returned_id,
                "documentUrl": "https://download.invalid/private",
            }
        )

        with self.assertRaises(DataKioskResponseError) as raised:
            download_document(fake_client, requested_id)

        error_text = str(raised.exception)
        self.assertIn("did not match", error_text)
        self.assertNotIn(requested_id, error_text)
        self.assertNotIn(returned_id, error_text)

    def test_non_object_api_payload_is_rejected_without_echoing_it(self) -> None:
        """Check response validation does not expose unexpected payload values."""
        sensitive_payload = "private-payload-value"

        with self.assertRaises(DataKioskResponseError) as raised:
            submit_query(
                FakeDataKioskClient(create_payload=sensitive_payload),
                "query Valid { field }",
            )

        self.assertNotIn(sensitive_payload, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
