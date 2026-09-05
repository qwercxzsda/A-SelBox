"""Tests for Data Kiosk query submission and lifecycle polling."""

import unittest
from unittest.mock import patch

from sp_api.base import SellingApiException, SellingApiRequestThrottledException

from ....src.amazon.data_kiosk import (
    DataKioskDocumentKind,
    DataKioskPollingTimeoutError,
    DataKioskQueryFailedError,
    DataKioskResponseError,
)
from ....src.amazon.data_kiosk.lifecycle import poll_query_until_complete, submit_query
from ...support.data_kiosk import (
    FakeDataKioskClient,
    FakeResponse,
)


class TestDataKioskQueryLifecycle(unittest.TestCase):
    def test_submit_query_passes_pagination_token_and_extracts_query_id(self) -> None:
        """Check createQuery input forwarding and response validation."""
        fake_client = FakeDataKioskClient(create_payload={"queryId": "query-2"})
        page_cursor = "next-page-token"

        query_id = submit_query(
            fake_client,
            "query Valid { field }",
            pagination_token=page_cursor,
        )

        self.assertEqual(query_id, "query-2")
        self.assertEqual(
            fake_client.create_calls,
            [("query Valid { field }", "next-page-token")],
        )

    def test_submit_query_rejects_missing_query_id(self) -> None:
        """Check that malformed createQuery responses fail immediately."""
        fake_client = FakeDataKioskClient(create_payload={})

        with self.assertRaisesRegex(DataKioskResponseError, "queryId"):
            submit_query(fake_client, "query Valid { field }")

    def test_submit_query_redacts_sdk_failure_context(self) -> None:
        """Keep query text and pagination tokens out of submission failures."""
        fake_client = FakeDataKioskClient()
        private_query = 'query Private { economics(label: "secret") }'
        private_cursor = "private-page-cursor"

        with (
            patch.object(
                fake_client,
                "create_query",
                side_effect=RuntimeError(f"{private_query} {private_cursor}"),
            ),
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            submit_query(
                fake_client,
                private_query,
                pagination_token=private_cursor,
            )

        self.assertNotIn(private_query, str(raised.exception))
        self.assertNotIn(private_cursor, str(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_submit_query_retries_429_and_honors_bounded_retry_after(self) -> None:
        """Use the server delay for one explicit throttle before succeeding."""
        fake_client = FakeDataKioskClient()
        private_payload = [{"code": "QuotaExceeded", "message": "private request"}]
        throttled = SellingApiRequestThrottledException(
            private_payload,
            headers={"Retry-After": "7"},
        )
        sleep_calls: list[float] = []

        with patch.object(
            fake_client,
            "create_query",
            side_effect=(throttled, FakeResponse({"queryId": "query-after-throttle"})),
        ) as create_query:
            query_id = submit_query(
                fake_client,
                "query Valid { field }",
                sleep=sleep_calls.append,
            )

        self.assertEqual(query_id, "query-after-throttle")
        self.assertEqual(create_query.call_count, 2)
        self.assertEqual(sleep_calls, [7.0])

    def test_submit_query_uses_fallback_for_untrusted_retry_after(self) -> None:
        """Reject malformed or excessive header values instead of trusting them."""
        fake_client = FakeDataKioskClient()
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": "private request"}],
            headers={"Retry-After": "999999"},
        )
        response = FakeResponse({"queryId": "query-fallback"})
        sleep_calls: list[float] = []

        with patch.object(fake_client, "create_query", side_effect=(throttled, response)):
            query_id = submit_query(
                fake_client,
                "query Valid { field }",
                throttle_retry_delay_seconds=12.0,
                sleep=sleep_calls.append,
            )

        self.assertEqual(query_id, "query-fallback")
        self.assertEqual(sleep_calls, [12.0])

    def test_submit_query_stops_after_throttle_attempt_bound_without_context(self) -> None:
        """Exhaust retries with one stable error and no retained SDK payload."""
        private_payload = "private throttled request payload"
        fake_client = FakeDataKioskClient()
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": private_payload}],
            headers={"Retry-After": "1"},
        )
        sleep_calls: list[float] = []

        with (
            patch.object(fake_client, "create_query", side_effect=throttled) as create_query,
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            submit_query(
                fake_client,
                "query Valid { field }",
                max_throttle_attempts=3,
                sleep=sleep_calls.append,
            )

        self.assertEqual(create_query.call_count, 3)
        self.assertEqual(sleep_calls, [1.0, 1.0])
        self.assertEqual(str(raised.exception), "Data Kiosk query submission failed.")
        self.assertNotIn(private_payload, repr(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_oversized_retry_after_preserves_bounded_sanitized_failure(self) -> None:
        """Do not let Python's integer-string limit expose the SDK exception."""
        fake_client = FakeDataKioskClient()
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": "private throttled request"}],
            headers={"Retry-After": "9" * 5000},
        )
        sleep_calls: list[float] = []

        with (
            patch.object(fake_client, "create_query", side_effect=throttled) as create_query,
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            submit_query(
                fake_client,
                "query Valid { field }",
                max_throttle_attempts=2,
                throttle_retry_delay_seconds=12.0,
                sleep=sleep_calls.append,
            )

        self.assertEqual(create_query.call_count, 2)
        self.assertEqual(sleep_calls, [12.0])
        self.assertEqual(str(raised.exception), "Data Kiosk query submission failed.")
        self.assertIsNone(raised.exception.__context__)

    def test_submit_query_does_not_retry_non_429_sdk_failure(self) -> None:
        """Do not repeat a mutation after an ambiguous non-throttle failure."""
        fake_client = FakeDataKioskClient()
        headers: dict[str, str] = {}
        failure = SellingApiException(
            [{"code": "InternalFailure", "message": "private 500 payload"}],
            headers=headers,
        )
        sleep_calls: list[float] = []

        with (
            patch.object(fake_client, "create_query", side_effect=failure) as create_query,
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            submit_query(
                fake_client,
                "query Valid { field }",
                sleep=sleep_calls.append,
            )

        create_query.assert_called_once()
        self.assertEqual(sleep_calls, [])
        self.assertIsNone(raised.exception.__context__)

    def test_polls_until_done_and_returns_document_and_pagination_ids(self) -> None:
        """Check bounded status polling and completion extraction."""
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {"processingStatus": "IN_QUEUE"},
                {"processingStatus": "IN_PROGRESS"},
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                    "pagination": {"nextToken": "next-token"},
                },
            ]
        )
        sleep_calls: list[float] = []

        completed = poll_query_until_complete(
            fake_client,
            "query-1",
            expected_query=fake_client.query,
            max_attempts=3,
            poll_interval_seconds=0.25,
            sleep=sleep_calls.append,
        )

        self.assertEqual(completed.query_id, "query-1")
        self.assertEqual(completed.document_kind, DataKioskDocumentKind.DATA)
        self.assertEqual(completed.data_document_id, "document-1")
        self.assertIsNone(completed.error_document_id)
        self.assertEqual(completed.next_pagination_token, "next-token")
        self.assertEqual(fake_client.query_calls, ["query-1", "query-1", "query-1"])
        self.assertEqual(sleep_calls, [0.25, 0.25])
        completed_repr = repr(completed)
        self.assertNotIn("query-1", completed_repr)
        self.assertNotIn("document-1", completed_repr)
        self.assertNotIn("next-token", completed_repr)

    def test_polling_retries_explicit_429_and_honors_retry_after(self) -> None:
        """Retry an idempotent getQuery read after one explicit SDK throttle."""
        fake_client = FakeDataKioskClient()
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": "private request"}],
            headers={"Retry-After": "7"},
        )
        completed_response = FakeResponse(
            {
                "queryId": "query-throttled",
                "query": fake_client.query,
                "processingStatus": "DONE",
            }
        )
        sleep_calls: list[float] = []

        with patch.object(
            fake_client,
            "get_query",
            side_effect=(throttled, completed_response),
        ) as get_query:
            completed = poll_query_until_complete(
                fake_client,
                "query-throttled",
                expected_query=fake_client.query,
                max_attempts=1,
                sleep=sleep_calls.append,
            )

        self.assertEqual(completed.document_kind, DataKioskDocumentKind.NO_DATA)
        self.assertEqual(get_query.call_count, 2)
        self.assertEqual(sleep_calls, [7.0])

    def test_polling_does_not_retry_non_429_sdk_failure(self) -> None:
        """Attempt a permanent getQuery failure once and redact its context."""
        fake_client = FakeDataKioskClient()
        headers: dict[str, str] = {}
        failure = SellingApiException(
            [{"code": "InternalFailure", "message": "private 500 payload"}],
            headers=headers,
        )
        sleep_calls: list[float] = []

        with (
            patch.object(fake_client, "get_query", side_effect=failure) as get_query,
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            poll_query_until_complete(
                fake_client,
                "query-permanent-failure",
                expected_query=fake_client.query,
                max_attempts=1,
                sleep=sleep_calls.append,
            )

        get_query.assert_called_once()
        self.assertEqual(sleep_calls, [])
        self.assertEqual(
            raised.exception.diagnostic_code,
            "DATA_KIOSK_GET_QUERY_REQUEST_FAILED",
        )
        self.assertIsNone(raised.exception.__context__)

    def test_polling_stops_after_explicit_throttle_attempt_bound(self) -> None:
        """Bound getQuery throttles independently from lifecycle status polls."""
        fake_client = FakeDataKioskClient()
        private_payload = "private throttled status payload"
        throttled = SellingApiRequestThrottledException(
            [{"code": "QuotaExceeded", "message": private_payload}],
            headers={"Retry-After": "1"},
        )
        sleep_calls: list[float] = []

        with (
            patch.object(fake_client, "get_query", side_effect=throttled) as get_query,
            self.assertRaises(DataKioskResponseError) as raised,
        ):
            poll_query_until_complete(
                fake_client,
                "query-throttle-exhausted",
                expected_query=fake_client.query,
                max_attempts=1,
                max_throttle_attempts=3,
                sleep=sleep_calls.append,
            )

        self.assertEqual(get_query.call_count, 3)
        self.assertEqual(sleep_calls, [1.0, 1.0])
        self.assertEqual(
            raised.exception.diagnostic_code,
            "DATA_KIOSK_GET_QUERY_REQUEST_FAILED",
        )
        self.assertNotIn(private_payload, repr(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_polling_timeout_is_bounded_and_does_not_sleep_after_last_attempt(self) -> None:
        """Check the exact attempt bound and sleep count on timeout."""
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {"processingStatus": "IN_QUEUE"},
                {"processingStatus": "IN_PROGRESS"},
            ],
        )
        sleep_calls: list[float] = []

        with self.assertRaises(DataKioskPollingTimeoutError) as raised:
            poll_query_until_complete(
                fake_client,
                "query-timeout",
                expected_query=fake_client.query,
                max_attempts=2,
                poll_interval_seconds=1.0,
                sleep=sleep_calls.append,
            )

        self.assertEqual(fake_client.query_calls, ["query-timeout", "query-timeout"])
        self.assertEqual(sleep_calls, [1.0])
        self.assertNotIn("query-timeout", str(raised.exception))

    def test_terminal_failure_keeps_ids_out_of_exception_text(self) -> None:
        """Check private failure metadata remains available only as attributes."""
        sensitive_row = "customer-private-row-content"
        fake_client = FakeDataKioskClient(
            query=sensitive_row,
            query_payloads=[
                {
                    "processingStatus": "FATAL",
                    "errorDocumentId": "error-document-1",
                    "query": sensitive_row,
                }
            ],
        )

        with self.assertRaises(DataKioskQueryFailedError) as raised:
            poll_query_until_complete(
                fake_client,
                "query-fatal",
                expected_query=fake_client.query,
                max_attempts=1,
            )

        self.assertEqual(raised.exception.processing_status, "FATAL")
        self.assertEqual(raised.exception.error_document_id, "error-document-1")
        error_text = str(raised.exception)
        self.assertNotIn("query-fatal", error_text)
        self.assertNotIn("error-document-1", error_text)
        self.assertNotIn(sensitive_row, error_text)

    def test_polling_rejects_mismatched_query_id_without_exposing_ids(self) -> None:
        """Check getQuery cannot substitute another query's status payload."""
        requested_id = "private-requested-query-id"
        returned_id = "private-returned-query-id"
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {
                    "queryId": returned_id,
                    "processingStatus": "DONE",
                }
            ]
        )

        with self.assertRaises(DataKioskResponseError) as raised:
            poll_query_until_complete(
                fake_client,
                requested_id,
                expected_query=fake_client.query,
                max_attempts=1,
            )

        error_text = str(raised.exception)
        self.assertIn("did not match", error_text)
        self.assertNotIn(requested_id, error_text)
        self.assertNotIn(returned_id, error_text)

    def test_polling_rejects_mismatched_query_text_without_echoing_it(self) -> None:
        """Check an explicit query ID cannot substitute a different query result."""
        expected_query = 'query Expected { economics(label: "private-a") }'
        returned_query = 'query Different { economics(label: "private-b") }'
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {
                    "query": returned_query,
                    "processingStatus": "DONE",
                }
            ]
        )

        with self.assertRaises(DataKioskResponseError) as raised:
            poll_query_until_complete(
                fake_client,
                "query-id",
                expected_query=expected_query,
                max_attempts=1,
            )

        error_text = str(raised.exception)
        self.assertNotIn(expected_query, error_text)
        self.assertNotIn(returned_query, error_text)

    def test_done_error_document_is_a_distinct_completed_outcome(self) -> None:
        """Check DONE can identify an error document without exposing its contents."""
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "errorDocumentId": "error-document-done",
                }
            ]
        )

        completed = poll_query_until_complete(
            fake_client,
            "query-done-error",
            expected_query=fake_client.query,
            max_attempts=1,
        )

        self.assertEqual(completed.document_kind, DataKioskDocumentKind.ERROR)
        self.assertIsNone(completed.data_document_id)
        self.assertEqual(completed.error_document_id, "error-document-done")

    def test_done_without_any_document_is_a_valid_no_data_outcome(self) -> None:
        """Check polling returns NO_DATA instead of treating it as malformed."""
        fake_client = FakeDataKioskClient(query_payloads=[{"processingStatus": "DONE"}])

        completed = poll_query_until_complete(
            fake_client,
            "query-no-data",
            expected_query=fake_client.query,
            max_attempts=1,
        )

        self.assertEqual(completed.document_kind, DataKioskDocumentKind.NO_DATA)
        self.assertIsNone(completed.data_document_id)
        self.assertIsNone(completed.error_document_id)

    def test_done_with_data_and_error_documents_is_rejected(self) -> None:
        """Check an internally inconsistent DONE response cannot be published."""
        fake_client = FakeDataKioskClient(
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "data-document-1",
                    "errorDocumentId": "error-document-1",
                }
            ]
        )

        with self.assertRaisesRegex(DataKioskResponseError, "both data and error"):
            poll_query_until_complete(
                fake_client,
                "query-inconsistent",
                expected_query=fake_client.query,
                max_attempts=1,
            )


if __name__ == "__main__":
    unittest.main()
