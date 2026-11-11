"""Saved manifests reject invented text before archive access or publication."""

import unittest
from copy import deepcopy
from typing import cast
from unittest.mock import Mock, patch

from services.sync.src.archives.serialization import data_kiosk_from_payload, data_kiosk_payload
from services.sync.src.database.acquisitions import persist_data_kiosk_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import complete_economics_document
from services.sync.tests.support.source_preprocessing import kiosk_acquisition


class ArchiveSerializationTests(unittest.TestCase):
    def test_inconsistent_api_provenance_fails_before_database_publication(self) -> None:
        storage = MemoryArchiveStorage()
        payload = data_kiosk_payload(kiosk_acquisition(storage, complete_economics_document()))
        cases: tuple[dict[str, object], ...] = (
            {"queryId": "different-query"},
            {"createdTime": "2020-01-01T00:00:00Z"},
            {"query": "query { differentScope }"},
            {"processingStatus": "FATAL"},
            {"dataDocumentId": "different-document"},
            {"errorDocumentId": "error"},
            {"pagination": {"nextToken": "missing-page"}},
            {"pagination": {"nextToken": 123}},
            {"pagination": []},
        )
        for overrides in cases:
            malformed = deepcopy(payload)
            pages = cast(list[dict[str, object]], malformed["documents"])
            metadata = cast(dict[str, object], pages[0]["api_metadata"])
            metadata.update(overrides)
            with (
                self.subTest(overrides=overrides),
                patch("services.sync.src.database.acquisitions.publish_json") as publish,
                self.assertRaises(ValueError),
            ):
                persist_data_kiosk_acquisition(Mock(), data_kiosk_from_payload(malformed))
            publish.assert_not_called()

    def test_root_metadata_and_exact_document_identity_are_validated_in_source_model(self) -> None:
        storage = MemoryArchiveStorage()
        payload = data_kiosk_payload(kiosk_acquisition(storage, complete_economics_document()))
        wrong_root = deepcopy(payload)
        wrong_root["api_metadata"] = {}
        with self.assertRaisesRegex(ValueError, "root page"):
            data_kiosk_from_payload(wrong_root)
        padded_document = deepcopy(payload)
        pages = cast(list[dict[str, object]], padded_document["documents"])
        pages[0]["document_id"] = " doc-1 "
        cast(dict[str, object], pages[0]["api_metadata"])["dataDocumentId"] = " doc-1 "
        with self.assertRaisesRegex(ValueError, "complete archived document"):
            data_kiosk_from_payload(padded_document)

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
