"""Tests for the in-memory Data Kiosk acquisition boundary."""

import unittest
from datetime import date

from ....src.amazon.data_kiosk.errors import DataKioskEconomicsNormalizationError
from ....src.data_kiosk_economics.acquisition import (
    download_and_process_data_kiosk_provision,
)
from ...support.data_kiosk import FakeDataKioskClient, fake_data_kiosk_downloads
from ...support.economics import complete_economics_document

MARKETPLACE_ID = "ATVPDKIKX0DER"


class TestProvisionAcquisition(unittest.TestCase):
    def test_downloads_parses_and_normalizes_entirely_in_memory(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-1"},
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                }
            ],
            document_payload={"document": complete_economics_document()},
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        result = download_and_process_data_kiosk_provision(
            client,
            marketplace_id=MARKETPLACE_ID,
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 1),
            poll_interval_seconds=0,
        )

        self.assertEqual(result.marketplace_id, MARKETPLACE_ID)
        self.assertEqual(tuple(fact.msku for fact in result.facts), ("SKU-1",))

    def test_reports_a_normalization_failure(self) -> None:
        client = FakeDataKioskClient(
            create_payload={"queryId": "query-1"},
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "dataDocumentId": "document-1",
                }
            ],
            document_payload={"document": b'{"not":"economics"}\n'},
        )
        self.enterContext(fake_data_kiosk_downloads(client))

        with self.assertRaises(DataKioskEconomicsNormalizationError):
            download_and_process_data_kiosk_provision(
                client,
                marketplace_id=MARKETPLACE_ID,
                query_start_date=date(2026, 8, 1),
                query_end_date=date(2026, 8, 1),
                poll_interval_seconds=0,
            )


if __name__ == "__main__":
    unittest.main()
