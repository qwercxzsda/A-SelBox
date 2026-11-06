"""Regression coverage for labels observed in real archived Amazon responses."""

import unittest
from dataclasses import replace

from ....src.allocation import AllocationCategory
from ....src.data_kiosk_economics.components import build_components
from ....src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from ....src.numeric import Numeric
from ...support.economics import complete_economics_fact


class ObservedComponentMappingTests(unittest.TestCase):
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
        ad = replace(fact.ads[0], ad_type_name="SponsoredProductFeeAdjustment")
        for candidate, reason, label in (
            (replace(fact, fees=(fee,), ads=(), cost=None), "UNKNOWN_FEE", fee.fee_type_name),
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
