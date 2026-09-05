"""Preserve each auxiliary charge's own source quantity through acquisition."""

import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from ....src.amazon.auxiliary_fees import AuxiliaryFeeBatch, AuxiliaryFeeSource
from ....src.amazon.data_kiosk.economics_normalization import derive_economics_fee_observations
from ....src.amazon.fba_reports.aged_storage_fees import normalize_parsed_aged_storage_fee_document
from ....src.amazon.fba_reports.parsing import (
    parse_aged_storage_fee_document,
    parse_removal_fee_document,
)
from ....src.amazon.fba_reports.removal_fees import normalize_parsed_removal_fee_document
from ....src.numeric import Numeric
from ....src.settlement_processing.acquisition import (
    AuxiliaryAcquisitionSettings,
    AuxiliaryClients,
    acquire_auxiliary_observations,
)
from ....src.settlement_processing.artifacts import ProcessingArtifactLog
from ....src.settlement_processing.models import AuxiliaryRequirements
from ....src.settlement_processing.raw_report import prepare_settlement_report
from ...support.economics import complete_economics_fact
from ...support.settlement_processing import stored_settlement_report
from ...support.settlement_processing_plans import make_id_factory


class TestAuxiliarySourceQuantities(unittest.TestCase):
    def test_data_kiosk_fee_and_ad_keep_their_own_quantities(self) -> None:
        fact = complete_economics_fact()
        fee = replace(
            fact.fees[0],
            fee_type_name="MonthlyInventoryStorageFee",
            aggregated_detail=replace(fact.fees[0].aggregated_detail, quantity=Numeric("2.5")),
        )
        normalized = derive_economics_fee_observations((replace(fact, fees=(fee,)),))
        batch = AuxiliaryFeeBatch(
            settlement_report_id="settlement-1",
            source_system=AuxiliaryFeeSource.DATA_KIOSK,
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_id=fact.marketplace_id,
            source_start_date=fact.start_date,
            source_end_date=fact.end_date,
            observations=normalized,
        )

        settlement = prepare_settlement_report(
            stored_settlement_report(), id_factory=make_id_factory()
        )
        with (
            TemporaryDirectory() as temporary_directory,
            patch(
                "services.sync.src.settlement_processing.acquisition._acquire_data_kiosk",
                return_value=batch,
            ),
        ):
            observations = acquire_auxiliary_observations(
                settlement,
                AuxiliaryRequirements(data_kiosk=True),
                AuxiliaryClients(),
                ProcessingArtifactLog.create(Path(temporary_directory), "processing-1"),
                AuxiliaryAcquisitionSettings(),
            )

        self.assertEqual(observations[0].category_code, "FBA_STORAGE_FEES")
        self.assertEqual(observations[0].quantity, Numeric("2.5"))
        self.assertEqual(observations[1].category_code, "SPONSORED_PRODUCTS_CHARGES")
        self.assertEqual(observations[1].quantity, Numeric(2))

    def test_data_kiosk_missing_quantity_stays_unknown(self) -> None:
        fact = complete_economics_fact()
        fee = replace(
            fact.fees[0],
            fee_type_name="MonthlyInventoryStorageFee",
            aggregated_detail=replace(fact.fees[0].aggregated_detail, quantity=None),
        )

        observations = derive_economics_fee_observations((replace(fact, fees=(fee,), ads=()),))

        self.assertIsNone(observations[0].quantity)

    def test_aged_storage_retains_charged_and_missing_quantities(self) -> None:
        document = (
            b"snapshot-date\tsku\tfnsku\tasin\tproduct-name\tcondition\tper-unit-volume\t"
            b"currency\tvolume-unit\tcountry\tqty-charged\tamount-charged\t"
            b"surcharge-age-tier\trate-surcharge\n"
            b"2026-08-15\tSKU-1\tF1\tA1\tProduct\tNew\t0.1\tUSD\tcu-ft\tUS\t3\t2\t365+\t1\n"
            b"2026-08-15\tSKU-2\tF2\tA2\tProduct\tNew\t0.1\tUSD\tcu-ft\tUS\t\t2\t365+\t1\n"
        )

        observations = normalize_parsed_aged_storage_fee_document(
            parse_aged_storage_fee_document(document, amazon_scope="NA"),
            marketplace_id="ATVPDKIKX0DER",
        )

        self.assertEqual(observations[0].quantity, Numeric(3))
        self.assertIsNone(observations[1].quantity)

    def test_removal_quantity_uses_disposed_or_shipped_units_for_its_category(self) -> None:
        document = (
            b"request-date\torder-id\torder-type\tsku\tdisposed-quantity\tshipped-quantity\t"
            b"removal-fee\tcurrency\n"
            b"2026-08-01\td1\tDisposal\tSKU-1\t3\t0\t2\tUSD\n"
            b"2026-08-01\tr1\tReturn\tSKU-1\t0\t4\t2\tUSD\n"
            b"2026-08-01\tr2\tReturn\tSKU-1\t0\t\t2\tUSD\n"
        )

        observations = normalize_parsed_removal_fee_document(
            parse_removal_fee_document(document, amazon_scope="NA"),
            marketplace_id="ATVPDKIKX0DER",
        )

        self.assertEqual(observations[0].quantity, Numeric(3))
        self.assertEqual(observations[1].quantity, Numeric(4))
        self.assertIsNone(observations[2].quantity)

    def test_return_without_shipped_column_keeps_quantity_unknown(self) -> None:
        document = (
            b"request-date\torder-id\torder-type\tsku\tdisposed-quantity\tremoval-fee\tcurrency\n"
            b"2026-08-01\tr1\tReturn\tSKU-1\t0\t2\tUSD\n"
        )

        observations = normalize_parsed_removal_fee_document(
            parse_removal_fee_document(document, amazon_scope="NA"),
            marketplace_id="ATVPDKIKX0DER",
        )

        self.assertIsNone(observations[0].quantity)
