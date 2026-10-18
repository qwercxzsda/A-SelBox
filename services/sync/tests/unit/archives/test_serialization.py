"""Saved manifests reject invented text before archive access or publication."""

import unittest
from copy import deepcopy
from typing import cast

from services.sync.src.archives.serialization import data_kiosk_from_payload, data_kiosk_payload
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import complete_economics_document
from services.sync.tests.support.source_preprocessing import kiosk_acquisition


class ArchiveSerializationTests(unittest.TestCase):
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
