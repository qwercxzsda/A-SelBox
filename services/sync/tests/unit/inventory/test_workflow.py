"""Offline replay verifies retained bytes and sends one complete optimistic replacement."""

import unittest
from collections.abc import Mapping
from typing import cast
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid7

from services.sync.src.archives.storage import ArchiveIntegrityError
from services.sync.src.database.acquisitions import load_inventory_acquisition
from services.sync.src.database.connection import DatabaseConnection
from services.sync.src.database.inventory import (
    publish_inventory_capture,
)
from services.sync.src.inventory.parser import prepare_inventory_report
from services.sync.src.inventory.serialization import inventory_payload
from services.sync.src.inventory.workflow import preprocess_inventory_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage

from .fixtures import MARKETPLACE, report_bytes, saved_acquisition

MODULE = "services.sync.src.inventory.workflow"


class InventoryWorkflowTests(unittest.TestCase):
    def test_offline_replay_uses_saved_scope_date_bytes_and_expected_capture(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = saved_acquisition(report_bytes({"sku": "sku", "available": "0"}), storage)
        expected = str(uuid7())
        with (
            patch(MODULE + ".load_inventory_acquisition", return_value=acquisition),
            patch(MODULE + ".current_inventory_capture", return_value=expected),
            patch(MODULE + ".publish_inventory_capture", return_value="capture") as publish,
            patch(
                "services.sync.src.amazon.credentials.load_lwa_credentials",
                side_effect=AssertionError("Offline replay touched credentials"),
            ),
        ):
            self.assertEqual(
                preprocess_inventory_acquisition(Mock(), storage, str(acquisition.id)), "capture"
            )
        self.assertEqual(publish.call_args.args[1], acquisition)
        self.assertEqual(publish.call_args.args[2].items[0]["available_quantity"], 0)
        self.assertEqual(publish.call_args.args[3], expected)

    def test_corrupt_archive_and_unusable_report_leave_capture_untouched(self) -> None:
        for corrupt in (False, True):
            storage = MemoryArchiveStorage()
            acquisition = saved_acquisition(b"not a usable report", storage)
            if corrupt:
                storage.objects[acquisition.document.bucket, acquisition.document.object_path] = (
                    b"bad"
                )
            with (
                self.subTest(corrupt=corrupt),
                patch(MODULE + ".load_inventory_acquisition", return_value=acquisition),
                patch(MODULE + ".current_inventory_capture", return_value=None),
                patch(MODULE + ".publish_inventory_capture") as publish,
                self.assertRaises((ValueError, ArchiveIntegrityError)),
            ):
                preprocess_inventory_acquisition(Mock(), storage, str(acquisition.id))
            publish.assert_not_called()

    def test_repository_payload_keeps_decimal_exact_and_matches_saved_capture_scope(self) -> None:
        storage = MemoryArchiveStorage()
        content = report_bytes(
            {"sku": "sku", "currency": "USD", "sales-shipped-last-90-days": "1.20"}
        )
        acquisition = saved_acquisition(content, storage)
        prepared = prepare_inventory_report(content, marketplace_id=MARKETPLACE)
        with patch(
            "services.sync.src.database.inventory.publish_json", return_value="saved"
        ) as publish:
            self.assertEqual(
                publish_inventory_capture(Mock(), acquisition, prepared, None), "saved"
            )
        payload = cast(Mapping[str, object], publish.call_args.args[2])
        self.assertEqual(payload["capture_date"], "2026-09-28")
        self.assertEqual(payload["row_count"], 1)
        self.assertIsNone(payload["expected_current_capture_id"])
        items = cast(list[dict[str, object]], payload["items"])
        self.assertEqual(items[0]["sales_amount_90d"], "1.20")

    def test_repository_load_checks_saved_manifest_and_uuid_before_database(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = saved_acquisition(report_bytes({"sku": "sku", "available": "1"}), storage)
        database = MagicMock(spec=DatabaseConnection)
        connection = database.connection.return_value.__enter__.return_value
        cursor = connection.cursor.return_value.__enter__.return_value
        payload = inventory_payload(acquisition)
        cursor.fetchone.return_value = payload
        self.assertEqual(load_inventory_acquisition(database, str(acquisition.id)), acquisition)
        payload["document_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digests"):
            load_inventory_acquisition(database, str(acquisition.id))
        database.reset_mock()
        with self.assertRaises(ValueError):
            load_inventory_acquisition(database, "invalid")
        database.connection.assert_not_called()
