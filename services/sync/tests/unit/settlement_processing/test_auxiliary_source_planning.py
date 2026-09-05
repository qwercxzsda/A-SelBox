"""Tests for transient observation periods and exclusive FBA source selection."""

import unittest
from datetime import date

from ....src.numeric import Numeric
from ....src.settlement_processing.models import CategoryMappingRule
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)


class TestAuxiliarySourcePlanning(unittest.TestCase):
    def test_auxiliary_period_matches_report_window_not_representative_date(self) -> None:
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
            "-4",
            transaction_type="ServiceFee",
            amount_type="Storage Fee",
            amount_description="Storage Fee",
            order_id=None,
            sku=None,
            posted_date=date(2026, 8, 20),
        )
        observation = make_auxiliary_observation(
            "-4",
            source_start_date=date(2026, 8, 2),
            source_end_date=date(2026, 8, 2),
        )

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            auxiliary_observations=[observation],
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        target = allocation_groups[0].targets[0]
        self.assertEqual(allocation_groups[0].representative_date, date(2026, 8, 20))
        self.assertEqual(target.join_method, "AGGREGATE_ALLOCATION")
        self.assertEqual(target.settlement_amount, Numeric("-4.000000"))
        self.assertEqual(target.difference_amount, Numeric(0))

    def test_aged_inventory_does_not_fill_missing_skus_with_data_kiosk(self) -> None:
        rule = CategoryMappingRule(
            10,
            "FBAFees",
            "FBA Long-Term Storage Fee",
            None,
            "FBA_AGED_INVENTORY_FEES",
            "SKU_PNL",
            "FBA_REPORT",
        )
        entry = make_ledger_entry(
            "aged-storage-1",
            "-10",
            transaction_type="FBAFees",
            amount_type="FBA Long-Term Storage Fee",
            amount_description="Aged inventory charge",
            order_id=None,
            sku=None,
        )
        observations = [
            make_auxiliary_observation(
                "-4.125",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-DK",
                source_start_date=date(2026, 8, 20),
                source_end_date=date(2026, 8, 20),
            ),
            make_auxiliary_observation(
                "-7.875",
                source_system="FBA_REPORT",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-FBA",
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            auxiliary_observations=observations,
            id_factory=make_id_factory(),
        )

        targets = allocation_groups[0].targets
        self.assertEqual(len(targets), 2)
        evidence_target = next(target for target in targets if target.amz_sku is not None)
        residual = next(target for target in targets if target.amz_sku is None)
        self.assertEqual(evidence_target.amz_sku, "SKU-FBA")
        self.assertEqual(evidence_target.settlement_amount, Numeric("-7.875000"))
        self.assertEqual(residual.settlement_amount, Numeric("-2.125000"))
        self.assertEqual(residual.unassigned_reason, "SETTLEMENT_RESIDUAL")
        self.assertEqual(sum((target.settlement_amount for target in targets), Numeric(0)), -10)

    def test_aged_inventory_does_not_fill_missing_fba_month_with_data_kiosk(self) -> None:
        rule = CategoryMappingRule(
            10,
            "FBAFees",
            "FBA Long-Term Storage Fee",
            None,
            "FBA_AGED_INVENTORY_FEES",
            "SKU_PNL",
            "FBA_REPORT",
        )
        entry = make_ledger_entry(
            "aged-storage-two-months",
            "-12",
            transaction_type="FBAFees",
            amount_type="FBA Long-Term Storage Fee",
            amount_description="Aged inventory charge",
            order_id=None,
            sku=None,
        )
        observations = [
            make_auxiliary_observation(
                "-6",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-DK-JULY",
                source_start_date=date(2026, 7, 15),
                source_end_date=date(2026, 7, 15),
            ),
            make_auxiliary_observation(
                "-7",
                source_system="FBA_REPORT",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-FBA-JULY",
                source_start_date=date(2026, 7, 15),
                source_end_date=date(2026, 7, 15),
            ),
            make_auxiliary_observation(
                "-5",
                category_code="FBA_AGED_INVENTORY_FEES",
                sku="SKU-DK-AUGUST",
                source_start_date=date(2026, 8, 15),
                source_end_date=date(2026, 8, 15),
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            auxiliary_observations=observations,
            report_first_date=date(2026, 7, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        targets_by_sku = {target.amz_sku: target for target in allocation_groups[0].targets}
        self.assertEqual(
            set(targets_by_sku),
            {"SKU-FBA-JULY", None},
        )
        self.assertEqual(targets_by_sku["SKU-FBA-JULY"].settlement_amount, Numeric(-7))
        self.assertEqual(targets_by_sku[None].settlement_amount, Numeric(-5))
        self.assertEqual(targets_by_sku[None].unassigned_reason, "SETTLEMENT_RESIDUAL")
        self.assertEqual(
            sum(
                (target.settlement_amount for target in targets_by_sku.values()),
                Numeric(0),
            ),
            Numeric(-12),
        )


if __name__ == "__main__":
    unittest.main()
