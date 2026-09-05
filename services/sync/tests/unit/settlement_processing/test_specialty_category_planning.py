"""Regression tests for specialty Settlement categories."""

import unittest

from ....src.numeric import Numeric
from ....src.settlement_processing.policy import SETTLEMENT_CATEGORY_RULES
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    make_id_factory,
    make_ledger_entry,
)


class TestSpecialtyCategoryPlanning(unittest.TestCase):
    def test_unknown_no_sku_entry_is_an_explicit_unattributed_residual(self) -> None:
        amount = "-0.000000000000000001"
        entry = make_ledger_entry(
            entry_id="mystery-1",
            amount=amount,
            transaction_type="MysteryTransaction",
            amount_type="MysteryAmount",
            amount_description="MysteryDescription",
            order_id=None,
            sku=None,
        )

        allocation_groups = build_test_allocation_groups(
            ledger_entries=[entry],
            rules=[],
            id_factory=make_id_factory(),
        )

        group = allocation_groups[0]
        target = group.targets[0]
        self.assertEqual(group.category_code, "UNMAPPED")
        self.assertEqual(group.handling_method, "UNASSIGNED")
        self.assertIsNone(target.company_id)
        self.assertEqual(target.join_method, "UNATTRIBUTED")
        self.assertEqual(target.unassigned_reason, "NO_AUXILIARY_SOURCE")
        self.assertEqual(target.settlement_amount, Numeric(amount))
        self.assertEqual(target.elaborated_amount, Numeric(0))
        self.assertEqual(target.difference_amount, target.settlement_amount)

    def test_transfer_beginning_balance_is_exactly_excluded(self) -> None:
        entry = make_ledger_entry(
            entry_id="beginning-balance",
            amount="-123456789012345678.123456789012345678",
            transaction_type="Transfer",
            amount_type="other-transaction",
            amount_description="Beginning Balance",
            order_id=None,
            sku=None,
            marketplace_id=None,
        )

        allocation_groups = build_test_allocation_groups(
            ledger_entries=[entry],
            rules=SETTLEMENT_CATEGORY_RULES,
            id_factory=make_id_factory(),
        )

        group = allocation_groups[0]
        target = group.targets[0]
        self.assertEqual(group.category_code, "PAYMENT_MOVEMENT")
        self.assertEqual(group.handling_method, "EXCLUDED")
        self.assertEqual(group.pnl_treatment, "EXCLUDED")
        self.assertIsNone(target.company_id)
        self.assertEqual(target.unassigned_reason, "EXCLUDED_MOVEMENT")
        self.assertEqual(target.settlement_amount, entry.settlement_amount)
        self.assertEqual(target.elaborated_amount, Numeric(0))
        self.assertEqual(target.difference_amount, entry.settlement_amount)


if __name__ == "__main__":
    unittest.main()
