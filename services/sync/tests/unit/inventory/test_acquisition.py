"""Inventory requests stop at their poll bound and publish only verified source archives."""

import gzip
import json
import unittest
from datetime import date
from typing import cast
from unittest.mock import Mock, patch

from services.sync.src.archives.storage import load_document_archive
from services.sync.src.inventory.acquisition import download_inventory_acquisition
from services.sync.src.inventory.models import INVENTORY_REPORT_TYPE, InventoryAcquisition
from services.sync.src.inventory.reports import request_inventory_report
from services.sync.src.inventory.serialization import inventory_from_payload, inventory_payload
from services.sync.tests.support.archives import MemoryArchiveStorage

from .fixtures import MARKETPLACE, ReportsClient, report_summary

MODULE = "services.sync.src.inventory.acquisition"


class InventoryAcquisitionTests(unittest.TestCase):
    def test_real_lifecycle_archives_gzip_and_uses_original_local_report_day(self) -> None:
        client = ReportsClient(
            report_summary(processingStatus="IN_PROGRESS"),
            report_summary(ignored_field="must-not-retain", url="https://example.com/private"),
        )
        storage = MemoryArchiveStorage()
        original = b"still malformed TSV bytes are archived first\r\n"
        sleep = Mock()
        with (
            patch(
                "services.sync.src.amazon.reports.documents.download_presigned_report_bytes",
                return_value=gzip.compress(original),
            ),
            patch.object(
                client,
                "get_report_document",
                return_value=Mock(
                    payload={
                        "reportDocumentId": "document",
                        "url": "https://example.com/private",
                        "compressionAlgorithm": "GZIP",
                    }
                ),
            ),
            patch(MODULE + ".persist_inventory_acquisition", return_value="saved") as publish,
        ):
            result = download_inventory_acquisition(
                client,
                Mock(),
                storage,
                amazon_scope="NA",
                seller_namespace="seller",
                marketplace_id=MARKETPLACE,
                sleep=sleep,
            )
        acquisition = cast(InventoryAcquisition, publish.call_args.args[1])
        self.assertEqual(result, "saved")
        self.assertEqual(acquisition.capture_date, date(2026, 9, 28))
        self.assertEqual(load_document_archive(storage, acquisition.document), original)
        self.assertEqual(inventory_from_payload(inventory_payload(acquisition)), acquisition)
        self.assertNotIn("ignored_field", str(acquisition.api_metadata))
        self.assertNotIn("https://", str(acquisition.api_metadata))
        self.assertEqual(
            client.create_calls,
            [
                {
                    "reportType": INVENTORY_REPORT_TYPE,
                    "marketplaceIds": [MARKETPLACE],
                }
            ],
        )
        sleep.assert_called_once_with(10.0)

    def test_terminal_failure_wrong_scope_and_incomplete_jobs_do_not_publish(self) -> None:
        for changes in (
            {"processingStatus": "CANCELLED"},
            {"processingStatus": "FATAL"},
            {"processingStatus": "UNKNOWN"},
            {"marketplaceIds": ["other"]},
            {"reportId": "other"},
            {"reportType": "other"},
            {"reportDocumentId": None},
        ):
            client = ReportsClient(report_summary(**changes))
            storage = MemoryArchiveStorage()
            with (
                self.subTest(fields=tuple(changes)),
                patch(MODULE + ".persist_inventory_acquisition") as publish,
                self.assertRaises((RuntimeError, ValueError)),
            ):
                download_inventory_acquisition(
                    client,
                    Mock(),
                    storage,
                    amazon_scope="NA",
                    seller_namespace="seller",
                    marketplace_id=MARKETPLACE,
                    sleep=Mock(),
                )
            publish.assert_not_called()
            self.assertEqual(storage.objects, {})

    def test_poll_limit_has_no_unbounded_wait_or_extra_request(self) -> None:
        client = ReportsClient(*[report_summary(processingStatus="IN_QUEUE")] * 3)
        sleep = Mock()
        with self.assertRaises(TimeoutError):
            request_inventory_report(
                client, MARKETPLACE, max_poll_attempts=3, poll_interval_seconds=0.5, sleep=sleep
            )
        self.assertEqual(client.polls, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_timed_out_new_and_resumed_reports_retain_the_recovery_id_in_failure_logs(
        self,
    ) -> None:
        for report_id in (None, "report"):
            client = ReportsClient(report_summary(processingStatus="IN_QUEUE"))
            with (
                self.subTest(resumed=report_id is not None),
                self.assertLogs(
                    "services.sync.src.archives.acquisition_logging", level="ERROR"
                ) as logs,
                self.assertRaises(TimeoutError),
            ):
                download_inventory_acquisition(
                    client,
                    Mock(),
                    MemoryArchiveStorage(),
                    amazon_scope="NA",
                    seller_namespace="seller",
                    marketplace_id=MARKETPLACE,
                    report_id=report_id,
                    max_poll_attempts=1,
                    sleep=Mock(),
                )
            failure = json.loads(logs.records[-1].getMessage())
            self.assertEqual(failure["report_id"], "report")
            self.assertEqual(failure["stage"], "poll_report")
            self.assertEqual(failure["publication_status"], "not_started")
            self.assertEqual(failure["verified_archive_count"], 0)

    def test_existing_report_skips_creation_and_preserves_original_observation(self) -> None:
        client = ReportsClient(report_summary(processingStatus="IN_PROGRESS"), report_summary())
        storage = MemoryArchiveStorage()
        with (
            patch(
                "services.sync.src.amazon.reports.documents.download_presigned_report_bytes",
                return_value=b"sku\tavailable\nitem\t1\n",
            ),
            patch(MODULE + ".persist_inventory_acquisition", return_value="saved") as publish,
        ):
            download_inventory_acquisition(
                client,
                Mock(),
                storage,
                amazon_scope="NA",
                seller_namespace="seller",
                marketplace_id=MARKETPLACE,
                report_id="report",
                sleep=Mock(),
            )
        acquisition = cast(InventoryAcquisition, publish.call_args.args[1])
        self.assertEqual(client.create_calls, [])
        self.assertEqual(client.polls, 2)
        self.assertEqual(acquisition.capture_date, date(2026, 9, 28))
        self.assertEqual(acquisition.api_metadata["request_mode"], "existing_report")

    def test_existing_report_still_rejects_cancelled_and_mismatched_responses(self) -> None:
        for changes in (
            {"processingStatus": "CANCELLED"},
            {"reportId": "other"},
            {"reportType": "other"},
            {"marketplaceIds": ["other"]},
        ):
            client = ReportsClient(report_summary(**changes))
            with self.subTest(fields=tuple(changes)), self.assertRaises((ValueError, RuntimeError)):
                request_inventory_report(client, MARKETPLACE, report_id="report", sleep=Mock())
            self.assertEqual(client.create_calls, [])

    def test_invalid_existing_report_id_fails_before_any_amazon_request(self) -> None:
        for value in ("", " ", " report "):
            client = ReportsClient()
            with self.subTest(value=value), self.assertRaises(ValueError):
                request_inventory_report(client, MARKETPLACE, report_id=value)
            self.assertEqual(client.create_calls, [])
            self.assertEqual(client.polls, 0)

    def test_unsupported_route_fails_before_creating_report(self) -> None:
        for scope, marketplace in (("EU", MARKETPLACE), ("EU", "A1805IZSGTT6HS")):
            client = ReportsClient()
            with self.subTest(scope=scope), self.assertRaises(ValueError):
                download_inventory_acquisition(
                    client,
                    Mock(),
                    MemoryArchiveStorage(),
                    amazon_scope=scope,
                    seller_namespace="seller",
                    marketplace_id=marketplace,
                )
            self.assertEqual(client.create_calls, [])

    def test_transport_error_is_sanitized_without_retaining_exception_context(self) -> None:
        client = ReportsClient()
        with (
            patch.object(client, "create_report", side_effect=RuntimeError("private-token-url")),
            self.assertRaises(RuntimeError) as caught,
        ):
            request_inventory_report(client, MARKETPLACE)
        self.assertNotIn("private-token-url", str(caught.exception))
        self.assertIsNone(caught.exception.__context__)
