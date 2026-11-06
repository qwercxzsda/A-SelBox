"""Regression coverage for labels observed in real archived Amazon responses."""

import unittest
from dataclasses import replace

from ....src.allocation import AllocationCategory
from ....src.data_kiosk_economics.components import build_components
from ....src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from ....src.data_kiosk_economics.preprocess import prepare_data_kiosk_acquisition
from ....src.numeric import Numeric
from ...support.archives import MemoryArchiveStorage
from ...support.economics import complete_economics_document, complete_economics_fact, economics_fee
from ...support.source_preprocessing import kiosk_acquisition


class ObservedComponentMappingTests(unittest.TestCase):
    def test_native_lightning_deal_fee_is_a_signed_cost_without_commission(self) -> None:
        for amount in ("6.25", "-6.25", "0"):
            with self.subTest(amount=amount):
                storage = MemoryArchiveStorage()
                document = complete_economics_document(
                    fees=f"[{economics_fee('RunLightningDealFee', amount=amount)}]"
                )
                days = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
                rows = days[0].transactions
                if amount == "0":
                    self.assertEqual(rows, ())
                    continue
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0].component_type, "RUN_LIGHTNING_DEAL_FEE")
                self.assertIs(rows[0].category, AllocationCategory.DATA_KIOSK)
                self.assertEqual(rows[0].amount, -Numeric(amount))
                self.assertIsNone(rows[0].fee_base)

    def test_observed_sponsored_product_fee_selects_data_kiosk_calculation_inputs(self) -> None:
        fact = complete_economics_fact()
        ad = replace(fact.ads[0], ad_type_name="SponsoredProductFee")
        rows = build_components(replace(fact, fees=(), ads=(ad,), cost=None))

        self.assertEqual(len(rows), 2)
        row = rows[1]
        self.assertEqual(row.component_type, "SPONSORED_PRODUCT_FEE")
        self.assertIs(row.category, AllocationCategory.DATA_KIOSK)
        self.assertEqual(row.amount, Numeric("-1.005"))
        self.assertEqual(row.currency, "USD")
        self.assertEqual(row.quantity, Numeric(2))
        self.assertIsNone(row.fee_base)

    def test_similar_unrecognized_fee_and_ad_labels_fail_allocation(self) -> None:
        fact = complete_economics_fact()
        fee = replace(fact.fees[0], fee_type_name="DigitalServicesFeeOther")
        deal = replace(fact.fees[0], fee_type_name="RunLightningDealFeeAdjustment")
        ad = replace(fact.ads[0], ad_type_name="SponsoredProductFeeAdjustment")
        for candidate, reason, label in (
            (replace(fact, fees=(fee,), ads=(), cost=None), "UNKNOWN_FEE", fee.fee_type_name),
            (replace(fact, fees=(deal,), ads=(), cost=None), "UNKNOWN_FEE", deal.fee_type_name),
            (replace(fact, fees=(), ads=(ad,), cost=None), "UNKNOWN_AD", ad.ad_type_name),
        ):
            with (
                self.subTest(reason=reason),
                self.assertRaises(UnresolvedDataKioskComponentError) as raised,
            ):
                build_components(candidate)
            self.assertEqual(raised.exception.reason, reason)
            self.assertEqual(raised.exception.label, label)
            self.assertEqual(raised.exception.source_line_number, fact.source_line_number)
            self.assertNotIn(label, str(raised.exception))
