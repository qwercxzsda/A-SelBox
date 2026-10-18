"""Finances controls and Data Kiosk allocations retain the same cost authority."""

import unittest

from ...src.allocation import AllocationCategory
from ...src.transaction_types.data_kiosk import DATA_KIOSK_TYPES
from ...src.transaction_types.finances import FINANCES_TYPES, classify_finances_component


class SourceCategoryAlignmentTests(unittest.TestCase):
    def test_reviewed_costs_are_controls_in_finances_and_allocations_in_kiosk(self) -> None:
        pairs = {
            "ADVERTISING": "SPONSORED_PRODUCTS",
            "STORAGE_FEES": "FBA_STORAGE_FEE",
            "AGED_STORAGE_FEES": "FBA_AGED_INVENTORY_SURCHARGE",
            "DISPOSAL_FEES": "DISPOSAL_FEE",
            "REMOVAL_FEES": "REMOVAL_FEE",
            "INBOUND_PLACEMENT_FEES": "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
            "INBOUND_TRANSPORTATION_FEES": "FBA_INBOUND_TRANSPORTATION_FEE",
            "INBOUND_TRANSPORTATION_PROGRAM_FEES": "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
            "LABELING_FEES": "LABELING_FEE",
            "COUPON_FEES": "COUPON_PARTICIPATION_FEE",
            "DEAL_FEES": "DEAL_PARTICIPATION_FEE",
        }
        finances = {row.component_type: row.category for row in FINANCES_TYPES}
        kiosk = {row.component_type: row.category for row in DATA_KIOSK_TYPES}
        self.assertEqual(
            {k for k, v in finances.items() if v is AllocationCategory.DATA_KIOSK}, set(pairs)
        )
        for source, target in pairs.items():
            self.assertIs(finances[source], kiosk[target])

    def test_unknown_paths_cannot_become_generic_account_adjustments(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported Finances"):
            classify_finances_component("ServiceFee", ("AmazonFees", "UnknownCharge", "Base"))

    def test_parent_tax_and_base_keep_same_fee_category(self) -> None:
        for detail in ("Base", "Tax"):
            self.assertIs(
                classify_finances_component(
                    "ServiceFee", ("AmazonFees", "FBAStorageFee", detail)
                ).category,
                AllocationCategory.DATA_KIOSK,
            )
