"""Tests for effective-dated transient company and fee ownership."""

import unittest
from datetime import date

from ....src.numeric import Numeric
from ....src.settlement_processing.models import (
    CategoryMappingRule,
    CompanySkuFeeRateCandidate,
    LedgerEntry,
)
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    make_auxiliary_observation,
    make_id_factory,
    make_ledger_entry,
)

_STORAGE_RULE = CategoryMappingRule(
    10,
    "ServiceFee",
    "Storage Fee",
    None,
    "FBA_STORAGE_FEES",
    "SKU_PNL",
    "DATA_KIOSK",
)


def _storage_entry(amount: str) -> LedgerEntry:
    return make_ledger_entry(
        "storage-1",
        amount,
        transaction_type="ServiceFee",
        amount_type="Storage Fee",
        amount_description="Storage Fee",
        order_id=None,
        sku=None,
    )


class TestAuxiliaryOwnershipPlanning(unittest.TestCase):
    def test_daily_observations_keep_separate_activity_dates(self) -> None:
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="fee-rate-a",
            company_id="company-a",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SHARED-SKU",
            valid_from=date(2026, 8, 1),
            valid_to=None,
            fee_rate_percent=Numeric(0),
        )
        observations = [
            make_auxiliary_observation(
                "-2",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 10),
                source_end_date=date(2026, 8, 10),
            ),
            make_auxiliary_observation(
                "-3",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 11),
                source_end_date=date(2026, 8, 11),
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [_storage_entry("-5")],
            [_STORAGE_RULE],
            [fee_rate],
            observations,
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        self.assertEqual(
            {
                (
                    target.activity_start_date,
                    target.activity_end_date,
                    target.settlement_amount,
                )
                for target in allocation_groups[0].targets
            },
            {
                (date(2026, 8, 10), date(2026, 8, 10), Numeric("-2.000000")),
                (date(2026, 8, 11), date(2026, 8, 11), Numeric("-3.000000")),
            },
        )

    def test_auxiliary_observations_follow_distinct_company_periods(self) -> None:
        fee_rates = [
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-a",
                company_id="company-a",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 1),
                valid_to=date(2026, 8, 10),
                fee_rate_percent=Numeric(0),
            ),
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-b",
                company_id="company-b",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 10),
                valid_to=date(2026, 8, 20),
                fee_rate_percent=Numeric(0),
            ),
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-c",
                company_id="company-c",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 20),
                valid_to=None,
                fee_rate_percent=Numeric(0),
            ),
        ]
        observations = [
            make_auxiliary_observation(
                "-2",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 5),
                source_end_date=date(2026, 8, 5),
            ),
            make_auxiliary_observation(
                "-3",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 12),
                source_end_date=date(2026, 8, 12),
            ),
            make_auxiliary_observation(
                "-4",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 25),
                source_end_date=date(2026, 8, 25),
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [_storage_entry("-10")],
            [_STORAGE_RULE],
            fee_rates,
            observations,
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        assigned_targets = [
            target for target in allocation_groups[0].targets if target.company_id is not None
        ]
        residual = next(target for target in allocation_groups[0].targets if target.amz_sku is None)
        self.assertEqual(
            {
                (
                    target.company_sku_fee_rate_id,
                    target.company_id,
                    target.settlement_amount,
                )
                for target in assigned_targets
            },
            {
                ("fee-rate-a", "company-a", Numeric("-2.000000")),
                ("fee-rate-b", "company-b", Numeric("-3.000000")),
                ("fee-rate-c", "company-c", Numeric("-4.000000")),
            },
        )
        self.assertEqual(residual.settlement_amount, Numeric("-1.000000"))

    def test_auxiliary_interval_spanning_ownership_boundary_is_unassigned(self) -> None:
        fee_rates = [
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-a",
                company_id="company-a",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 1),
                valid_to=date(2026, 8, 10),
                fee_rate_percent=Numeric(0),
            ),
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-b",
                company_id="company-b",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 10),
                valid_to=None,
                fee_rate_percent=Numeric(0),
            ),
        ]
        observation = make_auxiliary_observation(
            "-5",
            sku="SHARED-SKU",
            source_start_date=date(2026, 8, 9),
            source_end_date=date(2026, 8, 10),
        )

        allocation_groups = build_test_allocation_groups(
            [_storage_entry("-5")],
            [_STORAGE_RULE],
            fee_rates,
            [observation],
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        target = allocation_groups[0].targets[0]
        self.assertIsNone(target.company_id)
        self.assertEqual(target.amz_sku, "SHARED-SKU")
        self.assertEqual(target.unassigned_reason, "MISSING_COMPANY_ASSIGNMENT")
        self.assertEqual(target.elaborated_amount, Numeric("-5.000000"))
        self.assertEqual(target.difference_amount, Numeric(0))

    def test_auxiliary_targets_preserve_each_company_fee(self) -> None:
        fee_rates = [
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-1",
                company_id="company-a",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 1),
                valid_to=date(2026, 8, 15),
                fee_rate_percent=Numeric(5),
            ),
            CompanySkuFeeRateCandidate(
                company_sku_fee_rate_id="fee-rate-2",
                company_id="company-b",
                marketplace_id="ATVPDKIKX0DER",
                amz_sku="SHARED-SKU",
                valid_from=date(2026, 8, 15),
                valid_to=None,
                fee_rate_percent=Numeric(6),
            ),
        ]
        observations = [
            make_auxiliary_observation(
                "-2",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 10),
                source_end_date=date(2026, 8, 10),
            ),
            make_auxiliary_observation(
                "-3",
                sku="SHARED-SKU",
                source_start_date=date(2026, 8, 20),
                source_end_date=date(2026, 8, 20),
            ),
        ]

        allocation_groups = build_test_allocation_groups(
            [_storage_entry("-5")],
            [_STORAGE_RULE],
            fee_rates,
            observations,
            report_first_date=date(2026, 8, 1),
            report_end_date_exclusive=date(2026, 9, 1),
            id_factory=make_id_factory(),
        )

        self.assertEqual(
            {
                (target.company_sku_fee_rate_id, target.settlement_amount)
                for target in allocation_groups[0].targets
            },
            {
                ("fee-rate-1", Numeric("-2.000000")),
                ("fee-rate-2", Numeric("-3.000000")),
            },
        )


if __name__ == "__main__":
    unittest.main()
