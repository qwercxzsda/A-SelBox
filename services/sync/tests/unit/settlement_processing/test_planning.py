"""Tests for general non-direct Settlement processing plans."""

import unittest
from collections.abc import Iterator
from datetime import date

from ....src.numeric import Numeric
from ....src.settlement_processing.models import (
    AllocationTargetPlan,
    CategoryMappingRule,
    CompanySkuFeeRateCandidate,
)
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    direct_rules,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)


class _SinglePassFeeRates(list[CompanySkuFeeRateCandidate]):
    def __init__(self, values: list[CompanySkuFeeRateCandidate]) -> None:
        super().__init__(values)
        self.iteration_count = 0

    def __iter__(self) -> Iterator[CompanySkuFeeRateCandidate]:
        self.iteration_count += 1
        if self.iteration_count > 1:
            raise AssertionError("Fee-rate candidates were scanned more than once.")
        return super().__iter__()


class TestSettlementAllocationPlanning(unittest.TestCase):
    def test_fee_rate_candidates_are_indexed_once_for_multiple_targets(self) -> None:
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="fee-rate-1",
            company_id="company-1",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            valid_from=date(2026, 8, 1),
            valid_to=None,
            fee_rate_percent=Numeric(0),
        )
        fee_rates = _SinglePassFeeRates([fee_rate])

        allocation_groups = build_test_allocation_groups(
            [
                make_ledger_entry("entry-1", "10", order_id="order-1"),
                make_ledger_entry("entry-2", "20", order_id="order-2"),
            ],
            direct_rules(),
            fee_rates,
            id_factory=make_id_factory(),
        )

        self.assertEqual(fee_rates.iteration_count, 1)
        self.assertEqual(len(allocation_groups), 2)
        self.assertTrue(
            all(group.targets[0].company_id == "company-1" for group in allocation_groups)
        )

    def test_non_unattributed_target_rejects_missing_sku(self) -> None:
        with self.assertRaisesRegex(ValueError, "target shape"):
            AllocationTargetPlan(
                id="target-1",
                allocation_group_id="group-1",
                company_id=None,
                company_sku_fee_rate_id=None,
                marketplace_id="ATVPDKIKX0DER",
                amz_sku=None,
                join_method="DIRECT_SETTLEMENT",
                unassigned_reason="MISSING_COMPANY_ASSIGNMENT",
                settlement_amount=Numeric("1"),
                elaborated_amount=Numeric("1"),
                selbox_fee=Numeric("0"),
                activity_start_date=date(2026, 8, 1),
                activity_end_date=date(2026, 8, 1),
            )

    def test_assigned_target_requires_fee_rate(self) -> None:
        with self.assertRaisesRegex(ValueError, "target shape"):
            AllocationTargetPlan(
                id="target-1",
                allocation_group_id="group-1",
                company_id="company-1",
                company_sku_fee_rate_id="fee-rate-1",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SKU-1",
                join_method="DIRECT_SETTLEMENT",
                unassigned_reason=None,
                settlement_amount=Numeric(1),
                elaborated_amount=Numeric(1),
                selbox_fee=Numeric(0),
                activity_start_date=date(2026, 8, 1),
                activity_end_date=date(2026, 8, 1),
                fee_rate_percent=None,
            )

    def test_allocation_target_accepts_negative_zero_selbox_fee(self) -> None:
        target = AllocationTargetPlan(
            id="target-1",
            allocation_group_id="group-1",
            company_id=None,
            company_sku_fee_rate_id=None,
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            join_method="DIRECT_SETTLEMENT",
            unassigned_reason="MISSING_COMPANY_ASSIGNMENT",
            settlement_amount=Numeric("1"),
            elaborated_amount=Numeric("1"),
            selbox_fee=Numeric("-0.000000"),
            activity_start_date=date(2026, 8, 1),
            activity_end_date=date(2026, 8, 1),
        )

        self.assertEqual(target.selbox_fee, Numeric(0))

    def test_non_direct_and_excluded_groups_keep_full_difference(self) -> None:
        ad_rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Cost of Advertising",
            None,
            "ADVERTISING_COST",
            "SKU_PNL",
        )
        excluded_rule = CategoryMappingRule(
            20,
            None,
            None,
            "Payable to Amazon",
            "PAYMENT_MOVEMENT",
            "EXCLUDED",
        )
        entries = [
            make_ledger_entry(
                "ad-1",
                "-5.00",
                transaction_type="ServiceFee",
                amount_type="Cost of Advertising",
                amount_description="Sponsored Products",
                order_id=None,
                sku=None,
                marketplace_id=None,
            ),
            make_ledger_entry(
                "ad-2",
                "-2.00",
                transaction_type="ServiceFee",
                amount_type="Cost of Advertising",
                amount_description="Sponsored Products",
                order_id=None,
                sku=None,
                marketplace_id=None,
            ),
            make_ledger_entry(
                "payment-1",
                "-3.00",
                transaction_type="other-transaction",
                amount_type="other-transaction",
                amount_description="Payable to Amazon",
                order_id=None,
                sku=None,
                marketplace_id=None,
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            entries,
            [ad_rule, excluded_rule],
            id_factory=make_id_factory(),
        )

        self.assertEqual(len(allocation_groups), 2)
        groups = {group.category_code: group for group in allocation_groups}
        ad_target = groups["ADVERTISING_COST"].targets[0]
        excluded_target = groups["PAYMENT_MOVEMENT"].targets[0]
        self.assertEqual(ad_target.settlement_amount, Numeric("-7.000000"))
        self.assertEqual(ad_target.elaborated_amount, Numeric("0.000000"))
        self.assertEqual(ad_target.difference_amount, Numeric("-7.000000"))
        self.assertEqual(set(groups["ADVERTISING_COST"].ledger_entry_ids), {"ad-1", "ad-2"})
        self.assertEqual(groups["PAYMENT_MOVEMENT"].pnl_treatment, "EXCLUDED")
        self.assertEqual(excluded_target.difference_amount, Numeric("-3.000000"))

    def test_auxiliary_fee_amounts_are_exact_and_mismatch_is_null_sku_residual(
        self,
    ) -> None:
        rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Cost of Advertising",
            None,
            "ADVERTISING_COST",
            "SKU_PNL",
            "DATA_KIOSK",
        )
        entry = make_ledger_entry(
            "ad-1",
            "-10",
            transaction_type="ServiceFee",
            amount_type="Cost of Advertising",
            amount_description="Sponsored Ads",
            order_id=None,
            sku=None,
        )
        observations = [
            make_auxiliary_observation(
                "-3.333333333333333333",
                category_code="SPONSORED_PRODUCTS_CHARGES",
                sku="SKU-A",
            ),
            make_auxiliary_observation(
                "-5.111111111111111111",
                category_code="SPONSORED_BRANDS_CHARGES",
                sku="SKU-B",
            ),
        ]
        fee_rates = [
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id=f"fee-rate-{sku}",
                company_id=f"company-{sku}",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku=sku,
                valid_from=date(2026, 8, 1),
                valid_to=None,
                fee_rate_percent=Numeric(0),
            )
            for sku in ("SKU-A", "SKU-B")
        ]

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            fee_rates,
            observations,
            id_factory=make_id_factory(),
        )

        targets = allocation_groups[0].targets
        self.assertEqual(len(targets), 3)
        sku_targets = {target.amz_sku: target for target in targets if target.amz_sku}
        residual = next(target for target in targets if target.amz_sku is None)
        self.assertEqual(
            sku_targets["SKU-A"].settlement_amount,
            Numeric("-3.333333333333333333"),
        )
        self.assertEqual(
            sku_targets["SKU-B"].settlement_amount,
            Numeric("-5.111111111111111111"),
        )
        self.assertEqual(
            residual.settlement_amount,
            Numeric("-1.555555555555555556"),
        )
        self.assertEqual(residual.elaborated_amount, Numeric(0))
        self.assertEqual(residual.unassigned_reason, "SETTLEMENT_RESIDUAL")
        self.assertEqual(residual.join_method, "UNATTRIBUTED")
        self.assertEqual(
            sum((target.settlement_amount for target in targets), Numeric(0)),
            entry.settlement_amount,
        )
        self.assertEqual(set(sku_targets), {"SKU-A", "SKU-B"})
        self.assertTrue(
            all(
                target.join_method == "AGGREGATE_ALLOCATION" and target.difference_amount == 0
                for target in sku_targets.values()
            )
        )

    def test_exact_auxiliary_total_omits_zero_residual(self) -> None:
        rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Storage Fee",
            None,
            "FBA_STORAGE_FEES",
            "SKU_PNL",
            "DATA_KIOSK",
        )
        entry = make_ledger_entry(
            "storage-1",
            "-5",
            transaction_type="ServiceFee",
            amount_type="Storage Fee",
            amount_description="Storage Fee",
            order_id=None,
            sku=None,
        )

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            auxiliary_observations=[make_auxiliary_observation("-5")],
            id_factory=make_id_factory(),
        )

        targets = allocation_groups[0].targets
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0].join_method, "AGGREGATE_ALLOCATION")
        self.assertEqual(targets[0].settlement_amount, Numeric("-5.000000"))
        self.assertFalse(any(target.amz_sku is None for target in targets))

    def test_account_subscription_remains_unassigned_even_with_auxiliary_input(
        self,
    ) -> None:
        rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Subscription Fee",
            None,
            "SUBSCRIPTION_FEES",
            "ACCOUNT_EXPENSE",
        )
        entry = make_ledger_entry(
            "subscription-1",
            "-39.99",
            transaction_type="ServiceFee",
            amount_type="Subscription Fee",
            amount_description="Subscription Fee",
            order_id=None,
            sku=None,
        )

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            auxiliary_observations=[
                make_auxiliary_observation(
                    "-39.99",
                    category_code="SUBSCRIPTION_FEES",
                )
            ],
            id_factory=make_id_factory(),
        )

        target = allocation_groups[0].targets[0]
        self.assertIsNone(target.company_id)
        self.assertIsNone(target.amz_sku)
        self.assertEqual(target.elaborated_amount, Numeric(0))
        self.assertEqual(target.difference_amount, Numeric("-39.990000"))
        self.assertEqual(target.unassigned_reason, "ACCOUNT_LEVEL_EXPENSE")


if __name__ == "__main__":
    unittest.main()
