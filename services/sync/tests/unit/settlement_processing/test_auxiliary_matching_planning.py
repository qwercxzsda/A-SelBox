"""Tests for transient auxiliary evidence matching and non-direct grouping."""

import unittest
from dataclasses import replace
from datetime import date

from ....src.numeric import Numeric
from ....src.settlement_processing.models import (
    CategoryMappingRule,
    CompanySkuFeeRateCandidate,
)
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)


class TestAuxiliaryMatchingPlanning(unittest.TestCase):
    def test_inbound_transport_uses_data_kiosk_evidence_and_residual(self) -> None:
        """Keep the source amount unchanged and leave the Settlement mismatch explicit."""
        rule = CategoryMappingRule(
            10,
            "FBAFees",
            "FBA Amazon-Partnered Carrier Shipment Fee",
            None,
            "INBOUND_TRANSPORTATION_FEES",
            "SKU_PNL",
            "DATA_KIOSK",
        )
        entry = make_ledger_entry(
            "inbound-transport",
            "-30",
            transaction_type="FBAFees",
            amount_type="FBA Amazon-Partnered Carrier Shipment Fee",
            amount_description="Carrier charge",
            order_id=None,
            sku=None,
        )
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="transport-fee-rate",
            company_id="transport-company",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="TRANSPORT-SKU",
            valid_from=date(2026, 8, 1),
            valid_to=None,
            fee_rate_percent=Numeric(0),
        )
        observation = make_auxiliary_observation(
            "-29.19",
            category_code="INBOUND_TRANSPORTATION_FEES",
            sku="TRANSPORT-SKU",
            source_start_date=date(2026, 8, 12),
            source_end_date=date(2026, 8, 12),
        )

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            [fee_rate],
            [observation],
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        sku_target = next(target for target in allocation_groups[0].targets if target.amz_sku)
        residual = next(target for target in allocation_groups[0].targets if target.amz_sku is None)
        self.assertEqual(sku_target.amz_sku, "TRANSPORT-SKU")
        self.assertEqual(sku_target.settlement_amount, Numeric("-29.19"))
        self.assertEqual(sku_target.join_method, "AGGREGATE_ALLOCATION")
        self.assertEqual(sku_target.activity_start_date, date(2026, 8, 12))
        self.assertEqual(residual.settlement_amount, Numeric("-0.81"))
        self.assertEqual(residual.unassigned_reason, "SETTLEMENT_RESIDUAL")
        self.assertEqual(
            sum((target.settlement_amount for target in allocation_groups[0].targets), Numeric(0)),
            Numeric(-30),
        )

    def test_disposal_exact_reference_matches_outside_period(self) -> None:
        rule = CategoryMappingRule(
            10,
            None,
            None,
            "DisposalComplete",
            "DISPOSAL_FEES",
            "SKU_PNL",
            "FBA_REPORT",
        )
        entries = [
            make_ledger_entry(
                "disposal-1",
                "-2",
                transaction_type="other-transaction",
                amount_type="other-transaction",
                amount_description="DisposalComplete",
                order_id=None,
                sku=None,
                adjustment_id="removal-1",
            ),
            make_ledger_entry(
                "disposal-2",
                "-3",
                transaction_type="other-transaction",
                amount_type="other-transaction",
                amount_description="DisposalComplete",
                order_id=None,
                sku=None,
                adjustment_id="removal-2",
            ),
        ]
        exact_observations = [
            make_auxiliary_observation(
                "-2",
                source_system="FBA_REPORT",
                category_code="DISPOSAL_FEES",
                sku="SKU-A",
                removal_order_id="removal-1",
                source_start_date=date(2025, 9, 1),
                source_end_date=date(2025, 9, 1),
            ),
            make_auxiliary_observation(
                "-3",
                source_system="FBA_REPORT",
                category_code="DISPOSAL_FEES",
                sku="SKU-B",
                removal_order_id="removal-2",
                source_start_date=date(2025, 9, 1),
                source_end_date=date(2025, 9, 1),
            ),
        ]

        exact_groups = build_test_allocation_groups(
            entries,
            [rule],
            auxiliary_observations=exact_observations,
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )
        self.assertEqual(len(exact_groups), 2)
        self.assertTrue(all(group.targets[0].join_method == "EXACT_KEY" for group in exact_groups))

    def test_unkeyed_removal_observation_is_rejected(self) -> None:
        rule = CategoryMappingRule(
            10,
            None,
            None,
            "DisposalComplete",
            "DISPOSAL_FEES",
            "SKU_PNL",
            "FBA_REPORT",
        )
        entry = make_ledger_entry(
            "disposal-1",
            "-5",
            transaction_type="other-transaction",
            amount_type="other-transaction",
            amount_description="DisposalComplete",
            order_id=None,
            sku=None,
            adjustment_id="removal-1",
        )
        observation = make_auxiliary_observation(
            "-5",
            source_system="FBA_REPORT",
            category_code="DISPOSAL_FEES",
        )

        with self.assertRaisesRegex(ValueError, "exact removal_order_id"):
            build_test_allocation_groups(
                [entry],
                [rule],
                auxiliary_observations=[observation],
                id_factory=make_id_factory(),
            )

    def test_non_direct_grouping_uses_report_category_marketplace_grain(self) -> None:
        rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Storage Fee",
            None,
            "FBA_STORAGE_FEES",
            "SKU_PNL",
            "DATA_KIOSK",
        )
        common = make_ledger_entry(
            "storage-1",
            "-1.00",
            transaction_type="ServiceFee",
            amount_type="Storage Fee",
            amount_description="StorageFee",
            order_id="context-order",
            sku=None,
            adjustment_id="adjustment-1",
            shipment_id="shipment-1",
        )
        entries = [
            common,
            replace(
                common,
                id="storage-2",
                settlement_report_line_id="raw-storage-2",
                amazon_shipment_id="shipment-2",
            ),
            replace(
                common,
                id="storage-3",
                settlement_report_line_id="raw-storage-3",
                amazon_adjustment_id="adjustment-2",
            ),
            replace(
                common,
                id="storage-4",
                settlement_report_line_id="raw-storage-4",
                marketplace_id="A2EUQ1WTGCTBG2",
                marketplace_name="Amazon.ca",
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            entries,
            [rule],
            id_factory=make_id_factory(),
        )

        self.assertEqual(len(allocation_groups), 2)
        self.assertEqual(
            {
                (
                    group.amazon_order_id,
                    group.amazon_adjustment_id,
                    group.amazon_shipment_id,
                    group.marketplace_id,
                    group.marketplace_name,
                )
                for group in allocation_groups
            },
            {
                (
                    None,
                    None,
                    None,
                    "ATVPDKIKX0DER",
                    "Amazon.com",
                ),
                (
                    None,
                    None,
                    None,
                    "A2EUQ1WTGCTBG2",
                    "Amazon.ca",
                ),
            },
        )
        us_group = next(
            group for group in allocation_groups if group.marketplace_id == "ATVPDKIKX0DER"
        )
        self.assertEqual(set(us_group.ledger_entry_ids), {"storage-1", "storage-2", "storage-3"})

    def test_unreviewed_marketplace_name_is_not_an_auxiliary_wildcard(self) -> None:
        rule = CategoryMappingRule(
            10,
            "ServiceFee",
            "Storage Fee",
            None,
            "FBA_STORAGE_FEES",
            "SKU_PNL",
            "DATA_KIOSK",
        )
        base_entry = make_ledger_entry(
            "storage-unknown-marketplace",
            "-4",
            transaction_type="ServiceFee",
            amount_type="Storage Fee",
            amount_description="Storage Fee",
            order_id=None,
            sku=None,
        )
        unreviewed_entry = replace(
            base_entry,
            marketplace_id=None,
            marketplace_name="Unreviewed Marketplace",
        )
        observation = make_auxiliary_observation(
            "-4",
            marketplace_id="ATVPDKIKX0DER",
        )

        unreviewed_groups = build_test_allocation_groups(
            [unreviewed_entry],
            [rule],
            auxiliary_observations=[observation],
            id_factory=make_id_factory(),
        )
        unreviewed_target = unreviewed_groups[0].targets[0]
        self.assertIsNone(unreviewed_target.amz_sku)
        self.assertEqual(unreviewed_target.join_method, "UNATTRIBUTED")
        self.assertEqual(
            unreviewed_target.unassigned_reason,
            "NO_MATCHING_AUXILIARY_OBSERVATION",
        )

        account_level_groups = build_test_allocation_groups(
            [replace(unreviewed_entry, marketplace_name=None)],
            [rule],
            auxiliary_observations=[observation],
            id_factory=make_id_factory(),
        )
        account_level_target = account_level_groups[0].targets[0]
        self.assertEqual(account_level_target.amz_sku, "SKU-1")
        self.assertEqual(account_level_target.join_method, "AGGREGATE_ALLOCATION")


if __name__ == "__main__":
    unittest.main()
