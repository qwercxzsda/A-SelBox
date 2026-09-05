"""Tests for conditional transient-source selection."""

import unittest
from dataclasses import replace
from uuid import uuid4

from ....src.settlement_processing.raw_report import prepare_settlement_report
from ....src.settlement_processing.requirements import derive_auxiliary_requirements
from ...support.settlement_processing import stored_settlement_report


class TestAuxiliaryRequirements(unittest.TestCase):
    def setUp(self) -> None:
        self.entry = prepare_settlement_report(
            stored_settlement_report(),
            id_factory=lambda: str(uuid4()),
        ).ledger_entries[0]

    def test_data_kiosk_is_selected_for_advertising(self) -> None:
        requirement = derive_auxiliary_requirements(
            (
                replace(
                    self.entry,
                    transaction_type="ServiceFee",
                    amount_type="Cost of Advertising",
                    amount_description="TransactionTotalAmount",
                    amz_sku=None,
                ),
            )
        )
        self.assertTrue(requirement.data_kiosk)
        self.assertFalse(requirement.fba_aged_storage)
        self.assertFalse(requirement.fba_removal)

    def test_fba_long_term_is_selected_for_aged_storage(self) -> None:
        requirement = derive_auxiliary_requirements(
            (
                replace(
                    self.entry,
                    transaction_type="FBAFees",
                    amount_type="FBA Long-Term Storage Fee",
                    amount_description="Base fee",
                    amz_sku=None,
                ),
            )
        )
        self.assertFalse(requirement.data_kiosk)
        self.assertTrue(requirement.fba_aged_storage)
        self.assertFalse(requirement.fba_removal)

    def test_only_fba_removal_is_selected_for_disposal_and_return_fees(self) -> None:
        for amount_type in (
            "FBA Removal Order: Disposal Fee",
            "FBA Removal Order: Return Fee",
        ):
            with self.subTest(amount_type=amount_type):
                requirement = derive_auxiliary_requirements(
                    (
                        replace(
                            self.entry,
                            transaction_type="FBAFees",
                            amount_type=amount_type,
                            amount_description="Base fee",
                            amz_sku=None,
                        ),
                    )
                )
                self.assertFalse(requirement.data_kiosk)
                self.assertFalse(requirement.fba_aged_storage)
                self.assertTrue(requirement.fba_removal)

    def test_mixed_fba_and_advertising_fees_select_their_own_sources(self) -> None:
        entries = tuple(
            replace(
                self.entry,
                transaction_type=transaction_type,
                amount_type=amount_type,
                amount_description="Base fee",
                amz_sku=None,
            )
            for transaction_type, amount_type in (
                ("FBAFees", "FBA Long-Term Storage Fee"),
                ("FBAFees", "FBA Removal Order: Disposal Fee"),
                ("ServiceFee", "Cost of Advertising"),
            )
        )
        requirement = derive_auxiliary_requirements(entries)

        self.assertTrue(requirement.data_kiosk)
        self.assertTrue(requirement.fba_aged_storage)
        self.assertTrue(requirement.fba_removal)


if __name__ == "__main__":
    unittest.main()
