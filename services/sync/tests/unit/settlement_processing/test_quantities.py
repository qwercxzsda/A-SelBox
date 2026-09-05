"""Keep source quantities with their own monetary category and population."""

import unittest
from dataclasses import replace
from datetime import date

from ....src.numeric import ZERO, Numeric
from ....src.settlement_processing.models import CategoryMappingRule
from ....src.settlement_processing.policy import SETTLEMENT_CATEGORY_RULES
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    direct_rules,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)

_STORAGE_RULE = CategoryMappingRule(
    10, None, "other-transaction", None, "FBA_STORAGE_FEES", "SKU_PNL", "DATA_KIOSK"
)


class TestSettlementMetricQuantities(unittest.TestCase):
    def test_sales_refunds_and_fee_quantities_remain_separate(self) -> None:
        entries = [
            make_ledger_entry("sale", "20", quantity=2),
            make_ledger_entry("refund", "-10", quantity=1, transaction_type="Refund"),
            make_ledger_entry("fee", "-4", quantity=2, amount_type="ItemFees"),
        ]
        rules = [
            *direct_rules(),
            CategoryMappingRule(40, "Refund", "ItemPrice", "Principal", "REFUNDS", "SKU_PNL"),
        ]
        allocation_groups = build_test_allocation_groups(
            entries, rules, id_factory=make_id_factory()
        )

        targets = {group.category_code: group.targets[0] for group in allocation_groups}
        self.assertEqual(targets["PRODUCT_SALES"].settlement_quantity, Numeric(2))
        self.assertEqual(targets["REFUNDS"].settlement_quantity, Numeric(1))
        self.assertEqual(targets["REFERRAL_FEES"].settlement_quantity, Numeric(2))
        self.assertEqual(targets["PRODUCT_SALES"].selbox_fee_base_quantity, Numeric(2))
        self.assertIsNone(targets["REFUNDS"].selbox_fee_base_quantity)
        self.assertEqual(sum((target.settlement_amount for target in targets.values()), ZERO), 6)

    def test_summed_source_quantities_can_exceed_bigint(self) -> None:
        quantity = 2**63 - 1
        allocation_groups = build_test_allocation_groups(
            [make_ledger_entry("a", "1", quantity=quantity), make_ledger_entry("b", "2")],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        self.assertEqual(allocation_groups[0].targets[0].settlement_quantity, Numeric(2**63))

    def test_tax_and_shipping_tax_do_not_count_the_same_units_twice(self) -> None:
        allocation_groups = build_test_allocation_groups(
            [
                make_ledger_entry("sale", "20", quantity=2),
                make_ledger_entry("tax", "2", quantity=2, amount_description="Tax"),
                make_ledger_entry(
                    "shipping-tax", "1", quantity=2, amount_description="ShippingTax"
                ),
            ],
            SETTLEMENT_CATEGORY_RULES,
            id_factory=make_id_factory(),
        )

        targets = {group.category_code: group.targets[0] for group in allocation_groups}
        self.assertEqual(targets["PRODUCT_SALES"].settlement_quantity, Numeric(2))
        self.assertEqual(targets["SALES_TAX"].settlement_amount, Numeric(3))
        self.assertIsNone(targets["SALES_TAX"].settlement_quantity)
        self.assertIsNone(targets["SALES_TAX"].elaborated_quantity)
        self.assertIsNone(targets["SALES_TAX"].company_payable_quantity)

    def test_unknown_quantity_does_not_become_a_partial_denominator(self) -> None:
        allocation_groups = build_test_allocation_groups(
            [make_ledger_entry("a", "10", quantity=2), make_ledger_entry("b", "1", quantity=None)],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        target = allocation_groups[0].targets[0]
        self.assertIsNone(target.settlement_quantity)
        self.assertIsNone(target.elaborated_quantity)
        self.assertIsNone(target.selbox_fee_base_quantity)
        self.assertIsNone(target.company_payable_quantity)

    def test_zero_amount_preserves_known_quantity(self) -> None:
        allocation_groups = build_test_allocation_groups(
            [make_ledger_entry("a", "0", quantity=3)],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        self.assertEqual(allocation_groups[0].targets[0].settlement_quantity, Numeric(3))

    def test_auxiliary_quantity_stays_on_matched_sku_without_inventing_residual_units(self) -> None:
        source = replace(
            make_ledger_entry("storage", "-12", sku=None, amount_type="other-transaction"),
            quantity=100,
        )
        observations = [
            replace(make_auxiliary_observation("-4"), quantity=Numeric("2.5")),
            replace(make_auxiliary_observation("-6"), quantity=Numeric("1.5")),
        ]
        allocation_groups = build_test_allocation_groups(
            [source],
            [_STORAGE_RULE],
            auxiliary_observations=observations,
            id_factory=make_id_factory(),
        )

        matched, residual = allocation_groups[0].targets
        self.assertEqual(matched.settlement_amount, Numeric(-10))
        self.assertEqual(matched.settlement_quantity, Numeric(4))
        self.assertEqual(matched.elaborated_quantity, Numeric(4))
        self.assertEqual(matched.company_payable_quantity, Numeric(4))
        self.assertIsNone(matched.difference_quantity)
        self.assertIsNone(matched.selbox_fee_quantity)
        self.assertEqual(residual.settlement_amount, Numeric(-2))
        self.assertIsNone(residual.settlement_quantity)
        self.assertIsNone(residual.difference_quantity)

    def test_partial_auxiliary_quantity_remains_unknown(self) -> None:
        observations = [
            replace(make_auxiliary_observation("-4"), quantity=Numeric(2)),
            make_auxiliary_observation("-6"),
        ]
        allocation_groups = build_test_allocation_groups(
            [make_ledger_entry("storage", "-10", sku=None, amount_type="other-transaction")],
            [_STORAGE_RULE],
            auxiliary_observations=observations,
            id_factory=make_id_factory(),
        )

        self.assertIsNone(allocation_groups[0].targets[0].settlement_quantity)

    def test_entire_unallocated_source_keeps_quantity_with_its_difference(self) -> None:
        source = replace(
            make_ledger_entry("storage", "-10", sku=None, amount_type="other-transaction"),
            quantity=7,
        )
        allocation_groups = build_test_allocation_groups(
            [source], [_STORAGE_RULE], id_factory=make_id_factory()
        )

        residual = allocation_groups[0].targets[0]
        self.assertEqual(residual.settlement_quantity, Numeric(7))
        self.assertEqual(residual.difference_quantity, Numeric(7))
        self.assertIsNone(residual.elaborated_quantity)

    def test_observations_with_different_quantities_sort_deterministically(self) -> None:
        observations = [
            replace(make_auxiliary_observation("-5"), quantity=Numeric(2)),
            make_auxiliary_observation("-5"),
        ]
        allocation_groups = build_test_allocation_groups(
            [make_ledger_entry("storage", "-10", sku=None, amount_type="other-transaction")],
            [_STORAGE_RULE],
            auxiliary_observations=list(reversed(observations)),
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        self.assertEqual(allocation_groups[0].targets[0].settlement_amount, Numeric(-10))
        self.assertIsNone(allocation_groups[0].targets[0].settlement_quantity)
