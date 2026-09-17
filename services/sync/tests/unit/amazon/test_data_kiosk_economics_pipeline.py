"""Tests for separate Data Kiosk Economics download and parsing steps."""

import hashlib
import unittest
from decimal import Decimal
from unittest.mock import patch

from sp_api.base import SellingApiRequestThrottledException

from ....src.amazon.data_kiosk import (
    DailyMskuEconomicsFact,
    DataKioskDocumentError,
    DataKioskDocumentKind,
    DataKioskEconomicsNormalizationError,
    DataKioskErrorDocumentError,
    DataKioskPaginationLimitError,
    DataKioskQueryFailedError,
    DataKioskResponseError,
    DownloadedEconomicsDocuments,
)
from ....src.amazon.data_kiosk.economics_acquisition import iter_economics_document_pages
from ....src.amazon.data_kiosk.economics_preprocess import (
    normalize_parsed_economics_documents,
)
from ....src.amazon.data_kiosk.economics_source_parsing import (
    parse_economics_source_documents,
)
from ...support.data_kiosk import FakeDataKioskClient, FakeResponse, fake_data_kiosk_downloads
from ...support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


def _ad_page(sku: str, amount: str) -> bytes:
    charge = economics_aggregated_detail(amount)
    return complete_economics_document(
        msku=sku,
        ads=(f'[{{"adTypeName":"Sponsored Products charge","charge":{charge}}}]'),
    )


def _download(
    client: FakeDataKioskClient,
    query: str = "query Complete { economics }",
) -> DownloadedEconomicsDocuments:
    return DownloadedEconomicsDocuments(
        tuple(
            iter_economics_document_pages(
                client,
                query,
                poll_interval_seconds=0,
                sleep=lambda _seconds: None,
            )
        )
    )


def _parse_and_normalize(
    downloaded: DownloadedEconomicsDocuments,
) -> tuple[DailyMskuEconomicsFact, ...]:
    return normalize_parsed_economics_documents(parse_economics_source_documents(downloaded))


class TestEconomicsAcquisition(unittest.TestCase):
    def test_invalid_poll_settings_fail_before_submitting_a_remote_query(self) -> None:
        cases = (
            (0, 0.0),
            (True, 0.0),
            (1, -1.0),
            (1, float("nan")),
            (1, float("inf")),
        )
        for max_poll_attempts, poll_interval_seconds in cases:
            client = FakeDataKioskClient()
            with (
                self.subTest(attempts=max_poll_attempts, interval=poll_interval_seconds),
                self.assertRaises(ValueError),
            ):
                tuple(
                    iter_economics_document_pages(
                        client,
                        "query Complete { economics }",
                        max_poll_attempts=max_poll_attempts,
                        poll_interval_seconds=poll_interval_seconds,
                    )
                )
            self.assertEqual(client.create_calls, [])
            self.assertEqual(client.query_calls, [])

    def test_acquisition_uses_one_sleeper_for_all_api_retries_and_pending_polls(self) -> None:
        query = "query Complete { economics }"
        client = FakeDataKioskClient()
        sleep_calls: list[float] = []
        identity = {"queryId": "query-1", "query": query}

        def throttled(seconds: int) -> SellingApiRequestThrottledException:
            return SellingApiRequestThrottledException(
                [{"code": "QuotaExceeded", "message": "private request context"}],
                headers={"Retry-After": str(seconds)},
            )

        with (
            patch.object(
                client,
                "create_query",
                side_effect=(throttled(1), FakeResponse({"queryId": "query-1"})),
            ),
            patch.object(
                client,
                "get_query",
                side_effect=(
                    throttled(2),
                    FakeResponse(identity | {"processingStatus": "IN_PROGRESS"}),
                    FakeResponse(
                        identity | {"processingStatus": "DONE", "dataDocumentId": "document-1"}
                    ),
                ),
            ),
            patch.object(
                client,
                "get_document",
                side_effect=(
                    throttled(3),
                    FakeResponse(
                        {"documentId": "document-1", "documentUrl": "https://example.invalid"}
                    ),
                ),
            ),
            patch(
                "services.sync.src.amazon.data_kiosk.document_acquisition.download_presigned_bytes",
                return_value=b"{}\n",
            ),
        ):
            pages = tuple(
                iter_economics_document_pages(
                    client,
                    query,
                    poll_interval_seconds=0.25,
                    sleep=sleep_calls.append,
                )
            )

        self.assertEqual(pages[0].document, b"{}\n")
        self.assertEqual(sleep_calls, [1.0, 2.0, 0.25, 3.0])

    def test_simple_parser_preserves_rows_before_economics_validation(self) -> None:
        body = (
            b'\n{"startDate":"not-a-date","currency":"NOT-CURRENCY",'
            b'"amount":-1.250,"orderType":"Recycle"}\n'
        )
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-simple-parse"},
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-simple-parse",
                }
            ],
            document_payload={"document": body},
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        parsed = parse_economics_source_documents(_download(client))

        parsed_document = parsed.pages[0].parsed_document
        self.assertIsNotNone(parsed_document)
        if parsed_document is None:
            self.fail("DATA page must have a parsed document.")
        self.assertEqual(parsed_document.decoded_sha256, hashlib.sha256(body).hexdigest())
        self.assertEqual(parsed_document.rows[0].source_line_number, 2)
        self.assertEqual(parsed_document.rows[0].value["startDate"], "not-a-date")
        self.assertEqual(parsed_document.rows[0].value["currency"], "NOT-CURRENCY")
        self.assertEqual(parsed_document.rows[0].value["amount"], Decimal("-1.250"))
        self.assertEqual(parsed_document.rows[0].value["orderType"], "Recycle")
        with self.assertRaises(DataKioskEconomicsNormalizationError):
            normalize_parsed_economics_documents(parsed)

    def test_fatal_query_fails_before_download_even_with_an_error_document(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-fatal"},
            query_payloads=[{"processingStatus": "FATAL", "errorDocumentId": "error-document"}],
        )
        with self.assertRaises(DataKioskQueryFailedError) as raised:
            _download(client)
        self.assertEqual(raised.exception.processing_status, "FATAL")
        self.assertNotIn("error-document", repr(raised.exception))
        self.assertEqual(client.document_calls, [])

    def test_done_error_document_is_rejected_without_download_or_parsing(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-done-error"},
            query_payloads=[{"processingStatus": "DONE", "errorDocumentId": "error-document"}],
        )
        with self.assertRaises(DataKioskErrorDocumentError) as raised:
            _download(client)
        self.assertEqual(str(raised.exception), "Data Kiosk returned an error document.")
        self.assertIsNone(raised.exception.__context__)
        self.assertEqual(client.document_calls, [])

    def test_malformed_data_document_does_not_fail_download(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-invalid-data"},
            query_payloads=[
                {"processingStatus": "DONE", "dataDocumentId": "document-invalid-data"}
            ],
            document_payload={"document": b"not-jsonl"},
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        downloaded = _download(client)

        self.assertEqual(downloaded.pages[0].document, b"not-jsonl")
        with self.assertRaises(DataKioskDocumentError):
            _parse_and_normalize(downloaded)

    def test_fatal_without_error_document_preserves_terminal_failure(self) -> None:
        """No downloadable evidence means acquisition retains the terminal failure."""
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-fatal"},
            query_payloads=[{"processingStatus": "FATAL"}],
        )

        with self.assertRaises(DataKioskQueryFailedError):
            _download(client)

        self.assertEqual(client.query_calls, ["query-fatal"])
        self.assertEqual(client.document_calls, [])

    def test_retains_ordered_pages_for_later_complete_parsing(self) -> None:
        first_document = complete_economics_document(msku="SKU-1")
        second_document = complete_economics_document(msku="SKU-2")
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-2"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-page"},
                },
                {"processingStatus": "DONE", "dataDocumentId": "document-2"},
            ],
            document_payloads=[
                {"document": first_document},
                {"document": second_document},
            ],
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        downloaded = _download(client)

        self.assertEqual(
            [(page.page_number, page.document_kind) for page in downloaded.pages],
            [(1, DataKioskDocumentKind.DATA), (2, DataKioskDocumentKind.DATA)],
        )
        self.assertEqual(downloaded.query_ids, ("query-1", "query-2"))
        self.assertEqual(downloaded.document_ids, ("document-1", "document-2"))
        self.assertEqual(
            tuple(page.document for page in downloaded.pages),
            (first_document, second_document),
        )
        facts = _parse_and_normalize(downloaded)
        self.assertEqual([fact.msku for fact in facts], ["SKU-1", "SKU-2"])
        self.assertNotIn("query-1", repr(downloaded))
        self.assertNotIn("document-1", repr(downloaded))

    def test_retains_a_successful_no_data_page(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-empty"},
            query_payloads=[{"processingStatus": "DONE"}],
        )

        downloaded = _download(client)

        self.assertEqual(downloaded.query_ids, ("query-empty",))
        self.assertEqual(downloaded.document_ids, ())
        self.assertIsNone(downloaded.pages[0].document)
        self.assertEqual(downloaded.pages[0].document_kind, DataKioskDocumentKind.NO_DATA)
        self.assertEqual(_parse_and_normalize(downloaded), ())

    def test_pagination_and_parsing_cover_every_data_page(self) -> None:
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-2"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-page"},
                },
                {"processingStatus": "DONE", "dataDocumentId": "document-2"},
            ],
            document_payloads=[
                {"document": _ad_page("SKU-1", "1.01")},
                {"document": _ad_page("SKU-2", "2.02")},
            ],
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        downloaded = _download(client, "query Valid { economics }")
        facts = _parse_and_normalize(downloaded)
        self.assertEqual([item.msku for item in facts], ["SKU-1", "SKU-2"])
        self.assertEqual(
            client.create_calls,
            [
                ("query Valid { economics }", None),
                ("query Valid { economics }", "next-page"),
            ],
        )
        self.assertEqual(
            client.document_calls,
            [("document-1", False), ("document-2", False)],
        )

    def test_next_page_pairs_the_token_with_amazons_returned_query_text(self) -> None:
        original_query = "query Complete { economics }"
        returned_query = "query Complete{economics}"
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-2"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "query": returned_query,
                    "pagination": {"nextToken": "next-page"},
                },
                {"processingStatus": "DONE"},
            ],
        )

        downloaded = _download(client, original_query)

        self.assertEqual(len(downloaded.pages), 2)
        self.assertEqual(
            client.create_calls,
            [(original_query, None), (returned_query, "next-page")],
        )

    def test_stops_at_configured_page_bound(self) -> None:
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-page"},
                }
            ],
            document_payloads=[{"document": _ad_page("SKU-1", "1.01")}],
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        pages = iter_economics_document_pages(
            client,
            "query Valid { economics }",
            max_pages=1,
            poll_interval_seconds=0,
            sleep=lambda _seconds: None,
        )

        first_page = next(pages)
        self.assertFalse(first_page.is_terminal)
        self.assertEqual(first_page.document, _ad_page("SKU-1", "1.01"))
        with self.assertRaises(DataKioskPaginationLimitError):
            next(pages)

    def test_rejects_repeated_query_identity(self) -> None:
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-1"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "pagination": {"nextToken": "next-page"},
                }
            ],
        )

        with self.assertRaisesRegex(DataKioskResponseError, "repeated query identifier"):
            _download(client)
        self.assertEqual(client.query_calls, ["query-1"])

    def test_rejects_repeated_document_before_second_download(self) -> None:
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-2"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-page"},
                },
                {"processingStatus": "DONE", "dataDocumentId": "document-1"},
            ],
            document_payloads=[{"document": complete_economics_document(msku="SKU-1")}],
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        with self.assertRaisesRegex(DataKioskResponseError, "repeated document"):
            _download(client)
        self.assertEqual(client.document_calls, [("document-1", False)])

    def test_parser_rejects_duplicate_normalized_facts_across_pages(self) -> None:
        document = complete_economics_document(msku="SKU-1")
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "query-1"}, {"queryId": "query-2"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-page"},
                },
                {"processingStatus": "DONE", "dataDocumentId": "document-2"},
            ],
            document_payloads=[{"document": document}, {"document": document}],
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        downloaded = _download(client)

        with self.assertRaisesRegex(DataKioskResponseError, "duplicate normalized item"):
            _parse_and_normalize(downloaded)


if __name__ == "__main__":
    unittest.main()
