"""Regressions for exclusive FBA evidence in mixed Settlement reports."""

import unittest
from datetime import date

from ....src.numeric import Numeric
from ....src.settlement_processing.policy import SETTLEMENT_CATEGORY_RULES
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)


class TestFbaSourcePolicy(unittest.TestCase):
    def test_advertising_evidence_does_not_enable_aged_storage_fallback(self) -> None:
        aged_entry = make_ledger_entry(
            "aged-storage-1",
            "-10",
            transaction_type="FBAFees",
            amount_type="FBA Long-Term Storage Fee",
            amount_description="Base fee",
            order_id=None,
            sku=None,
        )
        advertising_entry = make_ledger_entry(
            "advertising-1",
            "-3",
            transaction_type="ServiceFee",
            amount_type="Cost of Advertising",
            amount_description="TransactionTotalAmount",
            order_id=None,
            sku=None,
        )
        observations = [
            make_auxiliary_observation(
                "-10",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-DK-AGED",
                source_start_date=date(2026, 8, 20),
                source_end_date=date(2026, 8, 20),
            ),
            make_auxiliary_observation(
                "-3",
                category_code="ADVERTISING_COST",
                sku="SKU-DK-ADVERTISING",
                source_start_date=date(2026, 8, 20),
                source_end_date=date(2026, 8, 20),
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [aged_entry, advertising_entry],
            SETTLEMENT_CATEGORY_RULES,
            auxiliary_observations=observations,
            id_factory=make_id_factory(),
        )

        groups = {group.category_code: group for group in allocation_groups}
        aged_targets = groups["FBA_AGED_INVENTORY_FEES"].targets
        self.assertEqual(len(aged_targets), 1)
        self.assertIsNone(aged_targets[0].amz_sku)
        self.assertEqual(aged_targets[0].settlement_amount, Numeric(-10))
        self.assertEqual(aged_targets[0].elaborated_amount, Numeric(0))
        self.assertEqual(aged_targets[0].unassigned_reason, "NO_MATCHING_AUXILIARY_OBSERVATION")

        advertising_targets = groups["ADVERTISING_COST"].targets
        self.assertEqual(len(advertising_targets), 1)
        self.assertEqual(advertising_targets[0].amz_sku, "SKU-DK-ADVERTISING")
        self.assertEqual(advertising_targets[0].join_method, "AGGREGATE_ALLOCATION")
        self.assertEqual(advertising_targets[0].settlement_amount, Numeric(-3))
        self.assertEqual(advertising_targets[0].difference_amount, Numeric(0))
        self.assertEqual(
            sum(
                (
                    target.settlement_amount
                    for group in allocation_groups
                    for target in group.targets
                ),
                Numeric(0),
            ),
            Numeric(-13),
        )

    def test_disposal_and_removal_reject_data_kiosk_even_with_exact_reference(self) -> None:
        for amount_type, category_code in (
            ("FBA Removal Order: Disposal Fee", "DISPOSAL_FEES"),
            ("FBA Removal Order: Return Fee", "REMOVAL_FEES"),
        ):
            with self.subTest(category_code=category_code):
                entry = make_ledger_entry(
                    "removal-1",
                    "-2.75",
                    transaction_type="FBAFees",
                    amount_type=amount_type,
                    amount_description="Base fee",
                    order_id=None,
                    adjustment_id="removal-order-1",
                    sku=None,
                )
                observation = make_auxiliary_observation(
                    "-2.75",
                    category_code=category_code,
                    sku="SKU-DK",
                    source_start_date=date(2026, 8, 20),
                    source_end_date=date(2026, 8, 20),
                    removal_order_id="removal-order-1",
                )

                allocation_groups = build_test_allocation_groups(
                    [entry],
                    SETTLEMENT_CATEGORY_RULES,
                    auxiliary_observations=[observation],
                    id_factory=make_id_factory(),
                )

                targets = allocation_groups[0].targets
                self.assertEqual(len(targets), 1)
                self.assertIsNone(targets[0].amz_sku)
                self.assertEqual(targets[0].join_method, "UNATTRIBUTED")
                self.assertEqual(targets[0].settlement_amount, Numeric("-2.75"))
                self.assertEqual(targets[0].elaborated_amount, Numeric(0))
                self.assertEqual(targets[0].unassigned_reason, "NO_MATCHING_AUXILIARY_OBSERVATION")


if __name__ == "__main__":
    unittest.main()
