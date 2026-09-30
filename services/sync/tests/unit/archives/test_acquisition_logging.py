"""Failed acquisitions retain useful, secret-free archive evidence in their logs."""

import json
import logging
import unittest
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from typing import cast
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid7

from psycopg.errors import SerializationFailure

from services.sync.src.amazon.data_kiosk.economics_downloads import DownloadedEconomicsPage
from services.sync.src.amazon.data_kiosk.models import (
    CompletedDataKioskQuery,
    DataKioskDocumentKind,
)
from services.sync.src.amazon.reports.models import DownloadedReportDocument
from services.sync.src.archives.storage import ArchiveStorage
from services.sync.src.settlements.acquisition import download_settlement_acquisition
from services.sync.tests.support.archives import (
    ACQUISITION_MODULE,
    SETTLEMENT_MODULE,
    MemoryArchiveStorage,
    download_kiosk_acquisition,
    page,
    settlement_reference,
)

LOGGER = "services.sync.src.archives.acquisition_logging"
PAGINATION_MODULE = "services.sync.src.amazon.data_kiosk.economics_acquisition"
ERROR_MARKER = "private-error-payload-and-signed-url"


class AcquisitionLoggingTests(unittest.TestCase):
    def setUp(self) -> None:
        clock = self.enterContext(patch(ACQUISITION_MODULE + ".datetime"))
        clock.now.return_value = datetime(2026, 9, 12, 12, tzinfo=UTC)

    def test_partial_pagination_failure_logs_retained_page_at_error_level(self) -> None:
        def pages() -> Iterator[DownloadedEconomicsPage]:
            yield page(1, terminal=False, content=b"retained source")
            raise RuntimeError(ERROR_MARKER)

        self._prepare_data_kiosk(pages())
        publish = self.enterContext(patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition"))
        storage = MemoryArchiveStorage()
        with self.assertLogs(LOGGER, level="ERROR") as captured, self.assertRaises(RuntimeError):
            download_kiosk_acquisition(storage)

        events = self._events(captured.records)
        failed = self._one(events, "acquisition_failed")
        self.assertEqual(failed["stage"], "download")
        self.assertEqual(failed["exception_type"], "RuntimeError")
        self.assertEqual(failed["publication_status"], "not_started")
        self.assertEqual(failed["verified_archive_count"], 1)
        retained = self._one(events, "archive_retained")
        self.assertEqual(retained["page_number"], 1)
        self.assertEqual(retained["query_id"], "query-1")
        self.assertEqual(retained["document_id"], "document-1")
        self.assertIn((retained["bucket"], retained["object_path"]), storage.objects)
        self.assertEqual(retained["attempt_id"], failed["attempt_id"])
        self._assert_no_publication_or_secrets(events, captured.records)
        publish.assert_not_called()

    def test_publication_failure_marks_commit_unconfirmed_and_retains_all_archives(self) -> None:
        self._prepare_data_kiosk(
            iter(
                [
                    page(1, terminal=False, content=b"source one"),
                    page(2, terminal=True, content=b"source two"),
                ]
            )
        )
        self.enterContext(
            patch(
                ACQUISITION_MODULE + ".persist_data_kiosk_acquisition",
                side_effect=SerializationFailure(ERROR_MARKER),
            )
        )
        storage = MemoryArchiveStorage()
        with (
            self.assertLogs(LOGGER, level="INFO") as captured,
            self.assertRaises(SerializationFailure),
        ):
            download_kiosk_acquisition(storage)

        events = self._events(captured.records)
        failed = self._one(events, "acquisition_failed")
        self.assertEqual(failed["stage"], "publication")
        self.assertEqual(failed["exception_type"], "SerializationFailure")
        self.assertEqual(failed["sqlstate"], "40001")
        self.assertEqual(failed["publication_status"], "unconfirmed")
        self.assertEqual(failed["verified_archive_count"], 2)
        retained = [event for event in events if event["event"] == "archive_retained"]
        self.assertEqual([event["page_number"] for event in retained], [1, 2])
        self.assertEqual(
            {(event["bucket"], event["object_path"]) for event in retained}, set(storage.objects)
        )
        self._assert_no_publication_or_secrets(events, captured.records)

    def test_settlement_publication_failure_keeps_uploaded_object_diagnostics(self) -> None:
        publish = self._prepare_settlement()
        publish.side_effect = RuntimeError(ERROR_MARKER)
        storage = MemoryArchiveStorage()
        with self.assertLogs(LOGGER, level="ERROR") as captured, self.assertRaises(RuntimeError):
            self._download_settlement(storage)

        events = self._events(captured.records)
        failed = self._one(events, "acquisition_failed")
        self.assertEqual(failed["stage"], "publication")
        self.assertEqual(failed["publication_status"], "unconfirmed")
        self.assertEqual(failed["verified_archive_count"], 1)
        retained = self._one(events, "archive_retained")
        self.assertEqual(retained["report_id"], "report")
        self.assertEqual(retained["report_document_id"], "document")
        self.assertIn((retained["bucket"], retained["object_path"]), storage.objects)
        self._assert_no_publication_or_secrets(events, captured.records)
        publish.assert_called_once()

    def test_upload_saved_then_raised_logs_pending_location_without_verified_success(self) -> None:
        class UnconfirmedStorage(MemoryArchiveStorage):
            def put(self, bucket: str, object_path: str, content: bytes) -> None:
                super().put(bucket, object_path, content)
                raise OSError(ERROR_MARKER)

        publish = self._prepare_settlement()
        storage = UnconfirmedStorage()
        with self.assertLogs(LOGGER, level="INFO") as captured, self.assertRaises(OSError):
            self._download_settlement(storage)

        events = self._events(captured.records)
        started = self._one(events, "archive_upload_started")
        failed = self._one(events, "acquisition_failed")
        self.assertEqual(failed["stage"], "archive")
        self.assertEqual(failed["publication_status"], "not_started")
        self.assertEqual(failed["verified_archive_count"], 0)
        self.assertEqual(failed["pending_archive_status"], "unconfirmed")
        pending = cast(dict[str, object], failed["pending_archive"])
        self.assertIsInstance(pending, dict)
        self.assertEqual(pending["object_path"], started["object_path"])
        self.assertIn((pending["bucket"], pending["object_path"]), storage.objects)
        self.assertNotIn("archive_verified", [event["event"] for event in events])
        self.assertNotIn("archive_retained", [event["event"] for event in events])
        self._assert_no_publication_or_secrets(events, captured.records)
        publish.assert_not_called()

    def test_poll_and_transfer_failures_log_query_identity_before_a_page_is_yielded(self) -> None:
        completed = CompletedDataKioskQuery(
            query_id="submitted-query",
            document_kind=DataKioskDocumentKind.DATA,
            data_document_id="download-document",
            error_document_id=None,
            next_pagination_token=None,
        )
        for failure_stage in ("poll", "document"):
            storage = MemoryArchiveStorage()
            with (
                self.subTest(failure_stage=failure_stage),
                patch(PAGINATION_MODULE + ".submit_query", return_value="submitted-query"),
                patch(
                    PAGINATION_MODULE + ".poll_query_until_complete",
                    return_value=completed,
                    side_effect=OSError(ERROR_MARKER) if failure_stage == "poll" else None,
                ),
                patch(
                    PAGINATION_MODULE + ".download_document", side_effect=OSError(ERROR_MARKER)
                ) as download,
                patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
                self.assertLogs(LOGGER, level="ERROR") as captured,
                self.assertRaises(OSError),
            ):
                download_kiosk_acquisition(storage)
            events = self._events(captured.records)
            failed = self._one(events, "acquisition_failed")
            self.assertEqual(failed["stage"], "download")
            self.assertEqual(failed["page_number"], 1)
            self.assertEqual(failed["query_id"], "submitted-query")
            self.assertEqual(
                failed["document_id"], None if failure_stage == "poll" else "download-document"
            )
            self.assertEqual(failed["verified_archive_count"], 0)
            self.assertEqual(failed["publication_status"], "not_started")
            self.assertIsNone(failed["pending_archive"])
            self.assertEqual(storage.objects, {})
            self.assertEqual(download.call_count, int(failure_stage == "document"))
            publish.assert_not_called()
            self._assert_no_publication_or_secrets(events, captured.records)

    def test_transaction_exit_failure_logs_unconfirmed_candidate_without_publication(self) -> None:
        self._prepare_data_kiosk(iter([page(1, terminal=True, content=b"whole source")]))
        candidate_id = uuid7()
        self.enterContext(patch(ACQUISITION_MODULE + ".uuid7", return_value=candidate_id))
        database = Mock()
        database.connection.return_value = MagicMock()
        connection = database.connection.return_value.__enter__.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (candidate_id,)
        transaction = connection.transaction.return_value
        transaction.__exit__.side_effect = RuntimeError(ERROR_MARKER)
        with self.assertLogs(LOGGER, level="INFO") as captured, self.assertRaises(RuntimeError):
            download_kiosk_acquisition(MemoryArchiveStorage(), database=database)

        cursor.execute.assert_called_once()
        cursor.fetchone.assert_called_once()
        transaction.__exit__.assert_called_once_with(None, None, None)
        events = self._events(captured.records)
        failed = self._one(events, "acquisition_failed")
        self.assertEqual(failed["stage"], "publication")
        self.assertEqual(failed["publication_status"], "unconfirmed")
        self.assertEqual(failed["candidate_acquisition_id"], str(candidate_id))
        self.assertEqual(failed["verified_archive_count"], 1)
        self._one(events, "archive_retained")
        self._assert_no_publication_or_secrets(events, captured.records)

    def test_direct_success_logs_context_and_published_identity_after_persistence(self) -> None:
        self._prepare_data_kiosk(iter([page(1, terminal=True, content=b"whole source")]))
        publish = self.enterContext(
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition", return_value="saved-id")
        )
        with self.assertLogs(LOGGER, level="INFO") as captured:

            def persist(_database: object, _acquisition: object) -> str:
                self.assertNotIn(
                    "acquisition_published",
                    [event["event"] for event in self._events(captured.records)],
                )
                return "saved-id"

            publish.side_effect = persist
            result = download_kiosk_acquisition(MemoryArchiveStorage())

        self.assertEqual(result, "saved-id")
        events = self._events(captured.records)
        started = self._one(events, "acquisition_started")
        self.assertEqual(UUID(str(started["attempt_id"])).version, 4)
        for event in events:
            self.assertEqual(event["attempt_id"], started["attempt_id"])
            self.assertEqual(event["source"], "data_kiosk")
            self.assertEqual(event["seller_namespace"], "seller")
            self.assertEqual(event["amazon_scope"], "NA")
            self.assertEqual(event["marketplace_id"], "ATVPDKIKX0DER")
            self.assertEqual(event["query_start_date"], "2026-08-01")
            self.assertEqual(event["query_end_date"], "2026-08-31")
        uploaded = self._one(events, "archive_upload_started")
        verified = self._one(events, "archive_verified")
        for key in (
            "bucket",
            "object_path",
            "archive_sha256",
            "document_sha256",
            "archive_byte_length",
            "document_byte_length",
        ):
            self.assertEqual(verified[key], uploaded[key])
        published = self._one(events, "acquisition_published")
        self.assertEqual(published["acquisition_id"], "saved-id")
        self.assertLess(events.index(verified), events.index(published))
        self.assertNotIn("acquisition_failed", [event["event"] for event in events])

    def test_no_data_success_does_not_log_an_invented_archive(self) -> None:
        self._prepare_data_kiosk(iter([page(1, terminal=True, content=None)]))
        self.enterContext(
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition", return_value="saved-id")
        )
        with self.assertLogs(LOGGER, level="INFO") as captured:
            download_kiosk_acquisition(MemoryArchiveStorage())
        events = self._events(captured.records)
        self._one(events, "acquisition_published")
        self.assertFalse(any(str(event["event"]).startswith("archive_") for event in events))

    def test_json_logs_escape_context_and_exclude_source_metadata_and_error_contents(self) -> None:
        metadata_marker = "raw-api-metadata-private-value"
        source_marker = b"raw-financial-source-private-value"
        item = page(1, terminal=True, content=source_marker)
        item = replace(item, api_metadata=dict(item.api_metadata) | {"extra": metadata_marker})
        self._prepare_data_kiosk(iter([item]))
        self.enterContext(
            patch(
                ACQUISITION_MODULE + ".persist_data_kiosk_acquisition",
                side_effect=RuntimeError(ERROR_MARKER),
            )
        )
        seller = "seller\nforged-log\tvalue"
        with self.assertLogs(LOGGER, level="INFO") as captured, self.assertRaises(RuntimeError):
            download_kiosk_acquisition(MemoryArchiveStorage(), seller_namespace=seller)
        events = self._events(captured.records)
        for event, record in zip(events, captured.records, strict=True):
            message = record.getMessage()
            self.assertEqual(event["seller_namespace"], seller)
            self.assertNotIn("\n", message)
            self.assertNotIn("\t", message)
            self.assertNotIn(metadata_marker, message)
            self.assertNotIn(source_marker.decode(), message)
            self.assertIsNone(record.exc_info)
        self._assert_no_publication_or_secrets(events, captured.records)

    def _prepare_data_kiosk(self, pages: Iterator[DownloadedEconomicsPage]) -> None:
        self.enterContext(
            patch(ACQUISITION_MODULE + ".iter_economics_document_pages", return_value=pages)
        )

    def _prepare_settlement(self) -> Mock:
        self.enterContext(
            patch(
                SETTLEMENT_MODULE + ".download_report_document",
                return_value=DownloadedReportDocument(b"source", None),
            )
        )
        return self.enterContext(
            patch(SETTLEMENT_MODULE + ".persist_settlement_acquisition", return_value="saved-id")
        )

    @staticmethod
    def _download_settlement(storage: ArchiveStorage) -> str:
        return download_settlement_acquisition(
            Mock(),
            Mock(),
            storage,
            settlement_reference(),
            amazon_scope="NA",
            seller_namespace="seller",
        )

    @staticmethod
    def _events(records: list[logging.LogRecord]) -> list[dict[str, object]]:
        return [cast(dict[str, object], json.loads(record.getMessage())) for record in records]

    def _one(self, events: list[dict[str, object]], name: str) -> dict[str, object]:
        matches = [event for event in events if event["event"] == name]
        self.assertEqual(len(matches), 1, f"Expected one {name} event: {events}")
        return matches[0]

    def _assert_no_publication_or_secrets(
        self, events: list[dict[str, object]], records: list[logging.LogRecord]
    ) -> None:
        self.assertNotIn("acquisition_published", [event["event"] for event in events])
        for record in records:
            self.assertNotIn(ERROR_MARKER, record.getMessage())
            self.assertIsNone(record.exc_info)
