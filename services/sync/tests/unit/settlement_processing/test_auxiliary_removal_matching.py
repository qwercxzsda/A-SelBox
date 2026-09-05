"""Tests for transient removal evidence whose request date predates Settlement."""

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


class TestAuxiliaryRemovalMatching(unittest.TestCase):
    def _assert_exact_removal(
        self,
        *,
        amount_type: str,
        amount_description: str,
        category_code: str,
        reference_id: str,
    ) -> None:
        rule = CategoryMappingRule(
            10,
            "FBAFees",
            amount_type,
            None,
            category_code,
            "SKU_PNL",
            "FBA_REPORT",
        )
        entry = make_ledger_entry(
            f"{category_code.lower()}-1",
            "-2.75",
            transaction_type="FBAFees",
            amount_type=amount_type,
            amount_description=amount_description,
            order_id=None,
            adjustment_id=reference_id,
            sku=None,
            posted_date=date(2026, 8, 20),
        )
        observation = make_auxiliary_observation(
            "-2.75",
            source_system="FBA_REPORT",
            category_code=category_code,
            source_start_date=date(2026, 5, 1),
            source_end_date=date(2026, 5, 1),
            removal_order_id=reference_id,
        )
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="removal-fee-rate",
            company_id="request-date-company",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            valid_from=date(2026, 5, 1),
            valid_to=date(2026, 8, 1),
            fee_rate_percent=Numeric(0),
        )

        allocation_groups = build_test_allocation_groups(
            [entry],
            [rule],
            fee_rate_candidates=[
                fee_rate,
                replace(
                    fee_rate,
                    company_sku_fee_rate_id="posted-date-fee-rate",
                    company_id="posted-date-company",
                    valid_from=date(2026, 8, 1),
                    valid_to=date(2026, 9, 1),
                ),
            ],
            auxiliary_observations=[observation],
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        target = allocation_groups[0].targets[0]
        self.assertEqual(allocation_groups[0].representative_date, date(2026, 5, 1))
        self.assertEqual(target.company_id, "request-date-company")
        self.assertEqual(target.company_sku_fee_rate_id, "removal-fee-rate")
        self.assertEqual(target.amz_sku, "SKU-1")
        self.assertEqual(target.join_method, "EXACT_KEY")
        self.assertEqual(target.activity_start_date, date(2026, 5, 1))
        self.assertEqual(target.activity_end_date, date(2026, 5, 1))
        self.assertEqual(target.settlement_amount, Numeric("-2.750000"))
        self.assertEqual(target.difference_amount, Numeric(0))
        self.assertEqual(observation.source_start_date, date(2026, 5, 1))
        self.assertEqual(observation.source_end_date, date(2026, 5, 1))
        self.assertEqual(entry.posted_date, date(2026, 8, 20))
        self.assertEqual(entry.posted_at.date(), date(2026, 8, 20))

    def test_exact_disposal_uses_request_date_for_accounting_and_ownership(self) -> None:
        self._assert_exact_removal(
            amount_type="FBA Removal Order: Disposal Fee",
            amount_description="DisposalComplete",
            category_code="DISPOSAL_FEES",
            reference_id="disposal-order-1",
        )

    def test_exact_return_uses_request_date_for_accounting_and_ownership(self) -> None:
        self._assert_exact_removal(
            amount_type="FBA Removal Order: Return Fee",
            amount_description="RemovalComplete",
            category_code="REMOVAL_FEES",
            reference_id="return-order-1",
        )

    def test_removal_order_does_not_match_other_settlement_identifiers(self) -> None:
        rule = CategoryMappingRule(
            10,
            "FBAFees",
            "FBA Removal Order: Disposal Fee",
            None,
            "DISPOSAL_FEES",
            "SKU_PNL",
            "FBA_REPORT",
        )
        entry = make_ledger_entry(
            "disposal-1",
            "-2.75",
            transaction_type="FBAFees",
            amount_type="FBA Removal Order: Disposal Fee",
            amount_description="DisposalComplete",
            order_id="removal-order-1",
            adjustment_id="different-adjustment",
            shipment_id="removal-order-1",
            sku=None,
        )
        observation = make_auxiliary_observation(
            "-2.75",
            source_system="FBA_REPORT",
            category_code="DISPOSAL_FEES",
            source_start_date=date(2026, 5, 1),
            source_end_date=date(2026, 5, 1),
            removal_order_id="removal-order-1",
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
        self.assertEqual(target.unassigned_reason, "NO_MATCHING_AUXILIARY_OBSERVATION")
        self.assertEqual(target.elaborated_amount, Numeric(0))


if __name__ == "__main__":
    unittest.main()
