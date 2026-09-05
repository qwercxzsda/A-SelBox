"""Tests for pure settlement-bound Data Kiosk Economics fee batches."""

import unittest
from datetime import date

from ....src.amazon.auxiliary_fees import AuxiliaryFeeBatch
from ....src.amazon.data_kiosk import (
    DataKioskDocumentKind,
    DataKioskEconomicsNormalizationError,
    DownloadedEconomicsDocuments,
    DownloadedEconomicsPage,
)
from ....src.amazon.data_kiosk.economics_batches import build_economics_fee_batch
from ....src.amazon.data_kiosk.economics_processing import (
    ParsedEconomicsFacts,
    normalize_parsed_economics_documents,
)
from ....src.amazon.data_kiosk.economics_source_parsing import (
    parse_economics_source_documents,
)
from ....src.numeric import Numeric
from ...support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


def _storage_page() -> bytes:
    detail = economics_aggregated_detail("1.234567890123456789")
    return complete_economics_document(
        fees=(
            '[{"feeTypeName":"MonthlyInventoryStorageFee","charges":['
            '{"identifier":"private-storage-charge","startDate":"2026-08-01",'
            f'"endDate":"2026-08-01","aggregatedDetail":{detail}}}]}}]'
        )
    )


def _parsed(document: bytes) -> ParsedEconomicsFacts:
    downloaded = DownloadedEconomicsDocuments(
        (
            DownloadedEconomicsPage(
                page_number=1,
                query_id="query-1",
                document_kind=DataKioskDocumentKind.DATA,
                is_terminal=True,
                document_id="document-1",
                document=document,
            ),
        )
    )
    return normalize_parsed_economics_documents(parse_economics_source_documents(downloaded))


def _build_batch(parsed: ParsedEconomicsFacts) -> AuxiliaryFeeBatch:
    return build_economics_fee_batch(
        parsed,
        settlement_report_id="settlement-1",
        seller_namespace="seller-1",
        amazon_scope="NA",
        marketplace_id="ATVPDKIKX0DER",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 2),
    )


class TestEconomicsFeeBatches(unittest.TestCase):
    def test_parsed_documents_build_a_contained_exact_batch(self) -> None:
        """The pure builder preserves the source window and exact Numeric evidence."""
        parsed = _parsed(_storage_page())

        batch = _build_batch(parsed)

        self.assertEqual(batch.source_start_date, date(2026, 8, 1))
        self.assertEqual(batch.source_end_date, date(2026, 8, 2))
        self.assertEqual(len(batch.observations), 1)
        observation = batch.observations[0]
        self.assertEqual(observation.observed_start_date, date(2026, 8, 1))
        self.assertEqual(observation.observed_end_date, date(2026, 8, 1))
        self.assertEqual(observation.reported_amount, Numeric("1.234567890123456789"))
        self.assertEqual(observation.normalized_amount, Numeric("-1.234567890123456789"))

    def test_rejects_parsed_facts_outside_the_submitted_scope(self) -> None:
        """The returned rows must match the requested marketplace and date window."""
        cases = (
            (
                "marketplace",
                _storage_page().replace(b"ATVPDKIKX0DER", b"A1VC38T7YXB528"),
            ),
            (
                "date window",
                _storage_page().replace(b'"2026-08-01"', b'"2026-07-31"'),
            ),
        )

        for expected_error, document in cases:
            with (
                self.subTest(expected_error=expected_error),
                self.assertRaisesRegex(
                    DataKioskEconomicsNormalizationError,
                    expected_error,
                ),
            ):
                _build_batch(_parsed(document))


if __name__ == "__main__":
    unittest.main()
