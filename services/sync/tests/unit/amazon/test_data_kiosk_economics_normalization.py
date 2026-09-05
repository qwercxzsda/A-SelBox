"""Tests for exact Data Kiosk Economics fee normalization."""

import gzip
import unittest
from datetime import date

from ....src.amazon.auxiliary_fees import (
    AuxiliaryFeeObservation,
    AuxiliaryFeeSource,
)
from ....src.amazon.data_kiosk import DataKioskEconomicsNormalizationError
from ....src.amazon.data_kiosk.document_processing import parse_jsonl_source_document
from ....src.amazon.data_kiosk.economics_fact_normalization import (
    normalize_parsed_daily_msku_economics_facts,
)
from ....src.amazon.data_kiosk.economics_normalization import (
    derive_economics_fee_observations,
)
from ....src.numeric import Numeric
from ...support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


def _economics_document() -> bytes:
    storage = economics_aggregated_detail("12.3400")
    aged = economics_aggregated_detail("3.005")
    sponsored_products = economics_aggregated_detail("0.1000000000000000000000000001")
    sponsored_brands = economics_aggregated_detail("2")
    return complete_economics_document(
        msku="PRIVATE-SKU-1",
        leading_newline=True,
        fees=(
            '[{"feeTypeName":"MonthlyInventoryStorageFee","charges":['
            '{"identifier":"storage-charge-private","startDate":"2026-08-01",'
            f'"endDate":"2026-08-01","aggregatedDetail":{storage}}}]}} ,'
            '{"feeTypeName":"FbaAgedInventorySurcharge","charges":['
            '{"identifier":"aged-charge-private","startDate":"2026-08-01",'
            f'"endDate":"2026-08-01","aggregatedDetail":{aged}}}]}} ,'
            '{"feeTypeName":"ReferralFees","charges":[]}]'
        ),
        ads=(
            '[{"adTypeName":"Sponsored Products charge","charge":'
            f"{sponsored_products}"
            '},{"adTypeName":"Headline Search Ads charge","charge":'
            f"{sponsored_brands}"
            '},{"adTypeName":"Unclassified advertising charge","charge":null}]'
        ),
    )


def _inbound_fee_document() -> bytes:
    placement = economics_aggregated_detail("119.2000000000000000001")
    transportation = economics_aggregated_detail("29.19")
    transportation_program = economics_aggregated_detail("7.01")
    unsupported = economics_aggregated_detail("88.88")
    return complete_economics_document(
        msku="PRIVATE-SKU-1",
        start_date="2026-08-02",
        end_date="2026-08-02",
        fees=(
            '[{"feeTypeName":"FBAInboundPlacementServiceFee","charges":['
            '{"identifier":"placement-charge-private","startDate":"2026-08-02",'
            f'"endDate":"2026-08-02","aggregatedDetail":{placement}}}]}} ,'
            '{"feeTypeName":"FbaInboundTransportationFee","charges":['
            '{"identifier":"transport-charge-private","startDate":"2026-08-02",'
            f'"endDate":"2026-08-02","aggregatedDetail":{transportation}}}]}} ,'
            '{"feeTypeName":"FbaInboundTransportationProgramFee","charges":['
            '{"identifier":"transport-program-charge-private",'
            '"startDate":"2026-08-02","endDate":"2026-08-02",'
            f'"aggregatedDetail":{transportation_program}}}]}} ,'
            '{"feeTypeName":"UnsupportedFeeType","charges":['
            '{"identifier":"unsupported-charge",'
            '"startDate":"2026-08-02","endDate":"2026-08-02",'
            f'"aggregatedDetail":{unsupported}}}]}}]'
        ),
    )


def _derive_observations(
    document: bytes,
    *,
    source_document_id: str,
) -> tuple[AuxiliaryFeeObservation, ...]:
    facts = normalize_parsed_daily_msku_economics_facts(
        parse_jsonl_source_document(document),
        source_document_id=source_document_id,
    )
    return derive_economics_fee_observations(facts)


class TestEconomicsNormalization(unittest.TestCase):
    def test_normalizes_storage_aged_storage_and_ads_with_exact_signs(self) -> None:
        """Check verbose taxonomy and charge-to-ledger sign conversion."""
        observations = _derive_observations(
            _economics_document(),
            source_document_id="private-document-id",
        )

        self.assertEqual(
            [observation.category_code for observation in observations],
            [
                "FBA_STORAGE_FEES",
                "FBA_AGED_INVENTORY_FEES",
                "SPONSORED_PRODUCTS_CHARGES",
                "SPONSORED_BRANDS_CHARGES",
            ],
        )
        self.assertEqual(
            [observation.reported_amount for observation in observations],
            [
                Numeric("12.3400"),
                Numeric("3.005"),
                Numeric("0.1000000000000000000000000001"),
                Numeric("2"),
            ],
        )
        self.assertEqual(
            [observation.normalized_amount for observation in observations],
            [
                Numeric("-12.3400"),
                Numeric("-3.005"),
                Numeric("-0.1000000000000000000000000001"),
                Numeric("-2"),
            ],
        )
        self.assertTrue(
            all(
                observation.source_system is AuxiliaryFeeSource.DATA_KIOSK
                for observation in observations
            )
        )
        self.assertTrue(all(observation.removal_order_id is None for observation in observations))
        self.assertEqual(
            len({observation.source_reference_hash for observation in observations}), 4
        )

    def test_normalizes_only_live_confirmed_inbound_fee_names(self) -> None:
        """Keep exact live fee names narrow and ignore unsupported taxonomy."""
        observations = _derive_observations(
            _inbound_fee_document(),
            source_document_id="private-document-id",
        )

        self.assertEqual(len(observations), 3)
        placement = observations[0]
        self.assertEqual(placement.category_code, "FBA_INBOUND_PLACEMENT_FEES")
        self.assertEqual(
            placement.reported_amount,
            Numeric("119.2000000000000000001"),
        )
        self.assertEqual(
            placement.normalized_amount,
            Numeric("-119.2000000000000000001"),
        )
        self.assertEqual(placement.observed_start_date, date(2026, 8, 2))
        self.assertEqual(placement.observed_end_date, date(2026, 8, 2))
        self.assertEqual(placement.source_grain["collection"], "fees")
        self.assertEqual(
            placement.taxonomy["canonical_fee_type_name"],
            "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
        )
        self.assertEqual(
            [observation.category_code for observation in observations[1:]],
            ["INBOUND_TRANSPORTATION_FEES", "INBOUND_TRANSPORTATION_FEES"],
        )
        self.assertEqual(
            [observation.reported_amount for observation in observations[1:]],
            [Numeric("29.19"), Numeric("7.01")],
        )
        self.assertEqual(
            [observation.normalized_amount for observation in observations[1:]],
            [Numeric("-29.19"), Numeric("-7.01")],
        )
        self.assertEqual(
            [observation.taxonomy["canonical_fee_type_name"] for observation in observations[1:]],
            [
                "FBA_INBOUND_TRANSPORTATION_FEE",
                "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
            ],
        )

    def test_preserves_native_grain_taxonomy_and_source_row_identity(self) -> None:
        """Keep document/line identity needed to link normalized output to parsed rows."""
        observations = _derive_observations(
            _economics_document(),
            source_document_id="private-document-id",
        )
        storage = observations[0]

        self.assertEqual(storage.observed_start_date, date(2026, 8, 1))
        self.assertEqual(storage.observed_end_date, date(2026, 8, 1))
        self.assertEqual(storage.marketplace_id, "ATVPDKIKX0DER")
        self.assertEqual(storage.amz_sku, "PRIVATE-SKU-1")
        self.assertEqual(storage.currency, "USD")
        self.assertEqual(storage.source_grain["date_granularity"], "DAY")
        self.assertEqual(storage.source_grain["product_identifier_granularity"], "MSKU")
        self.assertEqual(storage.source_grain["source_document_id"], "private-document-id")
        self.assertEqual(storage.source_grain["source_line_number"], 2)
        self.assertEqual(storage.taxonomy["fee_type_name"], "MonthlyInventoryStorageFee")
        self.assertEqual(storage.taxonomy["source_amount_sign"], "POSITIVE")
        self.assertEqual(len(storage.source_reference_hash), 64)
        self.assertEqual(len({item.source_reference_hash for item in observations}), 4)
        self.assertNotIn("PRIVATE-SKU-1", str(storage.source_grain))
        self.assertNotIn("PRIVATE-SKU-1", str(storage.taxonomy))

    def test_plain_and_gzip_documents_have_identical_normalized_evidence(self) -> None:
        """Check compression does not alter decoded hash, decimals, or source references."""
        document = _economics_document()

        plain = _derive_observations(
            document,
            source_document_id="document-1",
        )
        compressed = _derive_observations(
            gzip.compress(document),
            source_document_id="document-1",
        )

        self.assertEqual(plain, compressed)

    def test_preserves_negative_reported_charge_and_negates_it_once(self) -> None:
        """Check live signed totals retain their source sign before conversion."""
        charge = economics_aggregated_detail("-1.25")
        document = complete_economics_document(
            ads=(f'[{{"adTypeName":"Sponsored Display charge","charge":{charge}}}]')
        )

        observations = _derive_observations(
            document,
            source_document_id="document-1",
        )

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0].reported_amount, Numeric("-1.25"))
        self.assertEqual(observations[0].normalized_amount, Numeric("1.25"))
        self.assertEqual(observations[0].taxonomy["source_amount_sign"], "NEGATIVE")

    def test_rejects_fee_interval_outside_the_economics_row_period(self) -> None:
        """Check Amazon fee subperiods cannot escape their requested row period."""
        detail = economics_aggregated_detail("1.25")
        document = complete_economics_document(
            fees=(
                '[{"feeTypeName":"MonthlyInventoryStorageFee","charges":['
                '{"identifier":"private-charge","startDate":"2026-07-31",'
                f'"endDate":"2026-08-01","aggregatedDetail":{detail}}}]}}]'
            )
        )

        with self.assertRaises(DataKioskEconomicsNormalizationError) as raised:
            _derive_observations(
                document,
                source_document_id="document-1",
            )

        self.assertIn("startDate/endDate", str(raised.exception))
        self.assertNotIn("2026-07-31", str(raised.exception))

    def test_retains_incomplete_fee_intervals_without_emitting_exact_observations(
        self,
    ) -> None:
        """Keep nullable source dates in facts and require both for attribution."""
        incomplete = economics_aggregated_detail("1.25")
        complete = economics_aggregated_detail("-2.50")
        document = complete_economics_document(
            fees=(
                '[{"feeTypeName":"MonthlyInventoryStorageFee","charges":['
                '{"identifier":"incomplete-charge","startDate":null,'
                f'"endDate":"2026-08-01","aggregatedDetail":{incomplete}}}]}} ,'
                '{"feeTypeName":"FbaAgedInventorySurcharge","charges":['
                '{"identifier":"complete-charge","startDate":"2026-08-01",'
                f'"endDate":"2026-08-01","aggregatedDetail":{complete}}}]}}]'
            )
        )

        facts = normalize_parsed_daily_msku_economics_facts(
            parse_jsonl_source_document(document),
            source_document_id="document-1",
        )
        observations = derive_economics_fee_observations(facts)

        self.assertEqual(len(facts[0].fees), 2)
        self.assertIsNone(facts[0].fees[0].start_date)
        self.assertEqual(facts[0].fees[0].end_date, date(2026, 8, 1))
        self.assertEqual(
            facts[0].fees[1].aggregated_detail.total_amount.amount,
            Numeric("-2.50"),
        )
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0].reported_amount, Numeric("-2.50"))
        self.assertEqual(observations[0].normalized_amount, Numeric("2.50"))
        self.assertEqual(observations[0].taxonomy["source_amount_sign"], "NEGATIVE")

    def test_zero_charge_is_omitted(self) -> None:
        """Check a zero-value API fact cannot become an auxiliary fee observation."""
        charge = economics_aggregated_detail("0.000")
        document = complete_economics_document(
            ads=(f'[{{"adTypeName":"Sponsored Display charge","charge":{charge}}}]')
        )

        observations = _derive_observations(
            document,
            source_document_id="document-1",
        )

        self.assertEqual(observations, ())

    def test_malformed_amount_error_exposes_only_line_and_field(self) -> None:
        """Check invalid source values are not repeated in an exception."""
        charge = economics_aggregated_detail(
            '"private-invalid-value"',
            amount="1",
        )
        document = complete_economics_document(
            ads=(f'[{{"adTypeName":"Sponsored Products charge","charge":{charge}}}]')
        )

        with self.assertRaises(DataKioskEconomicsNormalizationError) as raised:
            _derive_observations(
                document,
                source_document_id="document-1",
            )

        self.assertIn("source line 1", str(raised.exception))
        self.assertIn("totalAmount.amount", str(raised.exception))
        self.assertNotIn("private-invalid-value", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
