"""Request-date ownership and reconciliation for removal-order charges."""

import unittest
from collections.abc import Sequence
from dataclasses import replace
from datetime import date

from ....src.numeric import ZERO, Numeric
from ....src.settlement_processing.models import (
    AllocationGroupPlan,
    AuxiliaryFeeObservation,
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

_REQUEST_DATE = date(2026, 5, 1)


def _entries() -> list[LedgerEntry]:
    return [
        make_ledger_entry(
            f"removal-{index}",
            amount,
            transaction_type="FBAFees",
            amount_type="FBA Removal Order: Return Fee",
            amount_description="RemovalComplete",
            order_id=f"order-{index}",
            adjustment_id="R1",
            shipment_id=f"shipment-{index}",
            sku=None,
            posted_date=posted_date,
        )
        for index, (amount, posted_date) in enumerate(
            [("-4.00", date(2026, 8, 10)), ("-6.00", date(2026, 8, 20))],
            start=1,
        )
    ]


def _observation(amount: str, sku: str = "SKU-1", quantity: int = 1) -> AuxiliaryFeeObservation:
    return replace(
        make_auxiliary_observation(
            amount,
            source_system="FBA_REPORT",
            category_code="REMOVAL_FEES",
            sku=sku,
            source_start_date=_REQUEST_DATE,
            source_end_date=_REQUEST_DATE,
            removal_order_id="R1",
        ),
        quantity=Numeric(quantity),
    )


def _groups(
    entries: Sequence[LedgerEntry],
    observations: Sequence[AuxiliaryFeeObservation],
) -> tuple[AllocationGroupPlan, ...]:
    rule = CategoryMappingRule(
        10,
        "FBAFees",
        "FBA Removal Order: Return Fee",
        None,
        "REMOVAL_FEES",
        "SKU_PNL",
        "FBA_REPORT",
    )
    fee_rates = [
        CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id=f"request-rate-{sku}",
            company_id=f"request-company-{sku}",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku=sku,
            valid_from=_REQUEST_DATE,
            valid_to=date(2026, 8, 1),
            fee_rate_percent=ZERO,
        )
        for sku in ("SKU-1", "SKU-2")
    ]
    return build_test_allocation_groups(
        entries,
        [rule],
        fee_rate_candidates=fee_rates,
        auxiliary_observations=observations,
        report_first_date=date(2026, 8, 1),
        report_end_date_exclusive=date(2026, 9, 1),
        id_factory=make_id_factory(),
    )


class TestRemovalRequestDatePlanning(unittest.TestCase):
    def test_same_reference_combines_posting_dates_and_other_ids_before_allocation(self) -> None:
        entries = _entries()
        groups = _groups(entries, [_observation("-10.00", quantity=3)])

        self.assertEqual(len(groups), 1)
        group = groups[0]
        self.assertEqual(group.amazon_adjustment_id, "R1")
        self.assertIsNone(group.amazon_order_id)
        self.assertIsNone(group.amazon_shipment_id)
        self.assertEqual(set(group.ledger_entry_ids), {entry.id for entry in entries})
        self.assertEqual(group.representative_date, _REQUEST_DATE)
        self.assertEqual(group.settlement_amount, Numeric("-10.00"))
        self.assertEqual(len(group.targets), 1)
        target = group.targets[0]
        self.assertEqual(target.join_method, "EXACT_KEY")
        self.assertEqual(target.settlement_amount, Numeric("-10.00"))
        self.assertEqual(target.elaborated_quantity, Numeric(3))
        self.assertEqual(target.company_id, "request-company-SKU-1")
        self.assertEqual(target.activity_start_date, _REQUEST_DATE)
        self.assertEqual(target.activity_end_date, _REQUEST_DATE)
        self.assertEqual(
            [entry.posted_date for entry in entries],
            [date(2026, 8, 10), date(2026, 8, 20)],
        )
        self.assertEqual([entry.amazon_order_id for entry in entries], ["order-1", "order-2"])
        self.assertEqual(
            [entry.amazon_shipment_id for entry in entries],
            ["shipment-1", "shipment-2"],
        )

    def test_sku_split_preserves_fba_quantities_and_settlement_total_with_residual(self) -> None:
        group = _groups(
            _entries(),
            [_observation("-6.00", quantity=2), _observation("-3.00", "SKU-2")],
        )[0]

        self.assertEqual(len(group.targets), 3)
        targets_by_sku = {target.amz_sku: target for target in group.targets}
        for sku, amount, quantity in [("SKU-1", "-6.00", 2), ("SKU-2", "-3.00", 1)]:
            target = targets_by_sku[sku]
            self.assertEqual(target.settlement_amount, Numeric(amount))
            self.assertEqual(target.elaborated_amount, Numeric(amount))
            self.assertEqual(target.settlement_quantity, Numeric(quantity))
            self.assertEqual(target.elaborated_quantity, Numeric(quantity))
            self.assertEqual(target.company_payable_quantity, Numeric(quantity))
            self.assertEqual(target.company_id, f"request-company-{sku}")
            self.assertEqual(target.join_method, "EXACT_KEY")
        residual = targets_by_sku[None]
        self.assertEqual(residual.unassigned_reason, "SETTLEMENT_RESIDUAL")
        self.assertEqual(residual.settlement_amount, Numeric("-1.00"))
        self.assertEqual(residual.elaborated_amount, ZERO)
        self.assertIsNone(residual.company_id)
        self.assertIsNone(residual.settlement_quantity)
        self.assertEqual(
            sum((target.settlement_amount for target in group.targets), ZERO),
            group.settlement_amount,
        )
        self.assertEqual(group.representative_date, _REQUEST_DATE)
        for target in group.targets:
            self.assertEqual(target.activity_start_date, _REQUEST_DATE)
            self.assertEqual(target.activity_end_date, _REQUEST_DATE)

    def test_missing_evidence_keeps_latest_posting_as_unassigned_fallback_date(self) -> None:
        groups = _groups(_entries(), [])

        self.assertEqual(len(groups), 1)
        group = groups[0]
        self.assertEqual(group.representative_date, date(2026, 8, 20))
        self.assertEqual(len(group.targets), 1)
        target = group.targets[0]
        self.assertEqual(target.settlement_amount, Numeric("-10.00"))
        self.assertEqual(target.unassigned_reason, "NO_MATCHING_AUXILIARY_OBSERVATION")
        self.assertIsNone(target.company_id)
        self.assertIsNone(target.amz_sku)
        self.assertEqual(target.activity_start_date, date(2026, 8, 20))
        self.assertEqual(target.activity_end_date, date(2026, 8, 20))

    def test_conflicting_request_dates_for_same_reference_are_rejected(self) -> None:
        observations = [
            _observation("-6.00"),
            replace(
                _observation("-4.00", "SKU-2"),
                source_start_date=date(2026, 5, 2),
                source_end_date=date(2026, 5, 2),
            ),
        ]

        with self.assertRaisesRegex(ValueError, "request date"):
            _groups(_entries(), observations)

    def test_request_date_must_be_a_single_day(self) -> None:
        for end_date in (date(2026, 4, 30), date(2026, 5, 2)):
            with (
                self.subTest(end_date=end_date),
                self.assertRaisesRegex(ValueError, "request date"),
            ):
                _groups(
                    _entries(),
                    [replace(_observation("-10.00"), source_end_date=end_date)],
                )


if __name__ == "__main__":
    unittest.main()
