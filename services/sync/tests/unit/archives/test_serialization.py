"""Saved manifests reject invented text before archive access or publication."""

import json
import unittest
from copy import deepcopy
from dataclasses import replace
from typing import cast
from unittest.mock import Mock, patch

from services.sync.src.archives.serialization import (
    data_kiosk_from_payload,
    data_kiosk_payload,
    settlement_from_payload,
    settlement_payload,
)
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import complete_economics_document
from services.sync.tests.support.source_preprocessing import (
    kiosk_acquisition,
    settlement_acquisition,
    settlement_document,
)


class ArchiveSerializationTests(unittest.TestCase):
    def test_valid_json_and_native_database_values_roundtrip_without_changing_identifiers(
        self,
    ) -> None:
        storage = MemoryArchiveStorage()
        settlement = settlement_acquisition(settlement_document({}), storage)
        settlement = replace(
            settlement,
            reference=replace(settlement.reference, report_id="000123", report_document_id=" doc "),
        )
        kiosk = kiosk_acquisition(storage, complete_economics_document())
        for acquisition, payload, decode in (
            (settlement, settlement_payload(settlement), settlement_from_payload),
            (kiosk, data_kiosk_payload(kiosk), data_kiosk_from_payload),
        ):
            with self.subTest(source=type(acquisition).__name__):
                self.assertEqual(decode(json.loads(json.dumps(payload))), acquisition)
                payload["id"] = acquisition.id
                payload["downloaded_at"] = acquisition.downloaded_at
                self.assertEqual(decode(payload), acquisition)

    def test_invalid_acquisition_or_nested_document_text_stops_before_processing(self) -> None:
        storage = MemoryArchiveStorage()
        settlement = settlement_payload(settlement_acquisition(settlement_document({}), storage))
        kiosk = data_kiosk_payload(kiosk_acquisition(storage, complete_economics_document()))
        for source, payload, workflow, current, publish in (
            (
                "settlement_preprocess",
                settlement,
                preprocess_settlement_acquisition,
                "current_settlement_versions",
                "publish_settlement",
            ),
            (
                "data_kiosk_economics",
                kiosk,
                preprocess_data_kiosk_acquisition,
                "current_data_kiosk_versions",
                "publish_data_kiosk",
            ),
        ):
            module = f"services.sync.src.{source}.workflow"
            for field in ("seller_namespace", "document.bucket"):
                for invalid in (None, 123, 1.5, True):
                    malformed = deepcopy(payload)
                    target = malformed
                    key = field
                    if field == "document.bucket":
                        if source == "data_kiosk_economics":
                            pages = cast(list[dict[str, object]], malformed["documents"])
                            target = pages[0]
                        target = cast(dict[str, object], target["document"])
                        key = "bucket"
                    target[key] = invalid
                    database, archives = Mock(), Mock()
                    with (
                        self.subTest(source=source, field=field, invalid=invalid),
                        patch(
                            "services.sync.src.database.acquisitions._load", return_value=malformed
                        ),
                        patch(module + "." + current) as selections,
                        patch(module + "." + publish) as publication,
                        self.assertLogs(module, level="ERROR"),
                        self.assertRaisesRegex(TypeError, "Manifest text"),
                    ):
                        workflow(database, archives, str(payload["id"]))
                    self.assertEqual(archives.mock_calls, [])
                    self.assertEqual(database.mock_calls, [])
                    selections.assert_not_called()
                    publication.assert_not_called()

    def test_nontext_page_query_and_marketplace_ids_are_rejected(self) -> None:
        storage = MemoryArchiveStorage()
        payload = data_kiosk_payload(kiosk_acquisition(storage, complete_economics_document()))
        for field in ("root_query_id", "page.query_id", "marketplace_ids"):
            for invalid in (None, 123):
                malformed = deepcopy(payload)
                if field == "page.query_id":
                    pages = cast(list[dict[str, object]], malformed["documents"])
                    pages[0]["query_id"] = invalid
                else:
                    malformed[field] = [invalid] if field == "marketplace_ids" else invalid
                with self.subTest(field=field, invalid=invalid), self.assertRaises(TypeError):
                    data_kiosk_from_payload(malformed)
