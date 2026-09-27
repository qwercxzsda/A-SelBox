"""Semantic report admission and complete version tests for accepted source policy."""

import unittest
from dataclasses import replace
from decimal import localcontext
from typing import cast
from unittest.mock import patch

from ....src.allocation import AllocationCategory
from ....src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from ....src.numeric import Numeric
from ....src.settlement_preprocess.raw_report import prepare_settlement_report
from ....src.settlement_preprocess.workflow import preprocess_settlement_report
from ...support.archives import MemoryArchiveStorage
from ...support.fakes import FakeDatabaseConnection
from ...support.source_preprocessing import (
    settlement_acquisition,
    settlement_document,
)


class SettlementSourceFactsTests(unittest.TestCase):
    def test_families_and_original_sku_evidence_form_an_exclusive_partition(self) -> None:
        document = settlement_document(
            {},
            {"transaction-type": "Refund", "amount": "-4"},
            {"transaction-type": "Liquidations", "marketplace-name": ""},
            {
                "transaction-type": "other-transaction",
                "amount-type": "FBA Inventory Reimbursement",
                "amount-description": "WAREHOUSE_DAMAGE",
                "marketplace-name": "",
            },
            {
                "transaction-type": "AmazonFees",
                "amount-type": "FBA fulfilment fee per unit - Reversal",
                "amount-description": "Base fee",
            },
            {
                "transaction-type": "Debt Adjustment",
                "amount-type": "Debt Adjustment",
                "amount-description": "Cross-Account Debt Adjustment against ES, NL",
                "sku": "",
            },
            {
                "transaction-type": "other-transaction",
                "amount-type": "other-transaction",
                "amount-description": "Subscription Fee",
                "sku": "",
            },
            {
                "transaction-type": "FBAFees",
                "amount-type": "Inbound Defect Fee",
                "amount-description": "Base fee",
                "sku": "  original-SKU  ",
            },
        )
        prepared = prepare_settlement_report(document)
        self.assertEqual(
            [row.category for row in prepared.transactions],
            [AllocationCategory.SETTLEMENT] * 5 + [AllocationCategory.SELBOX] * 3,
        )
        self.assertEqual(prepared.transactions[1].component_type, "PRODUCT_REFUNDS")
        self.assertEqual(prepared.transactions[1].amount, Numeric(-4))
        self.assertEqual(prepared.transactions[2].marketplace_name, None)
        self.assertEqual(prepared.transactions[-1].sku, "  original-SKU  ")
        self.assertEqual(prepared.diagnostics, ())

    def test_explicit_cost_decisions_preserve_data_kiosk_and_retained_selbox_amounts(self) -> None:
        rows = (
            ("FBAFees", "FBA Inventory Storage Fee", "Tax on fee", AllocationCategory.DATA_KIOSK),
            (
                "FBAFees",
                "FBA Removal Order: Disposal Fee",
                "Base fee",
                AllocationCategory.DATA_KIOSK,
            ),
            (
                "AmazonFees",
                "Coupon Performance Based Fee",
                "Base fee",
                AllocationCategory.DATA_KIOSK,
            ),
            (
                "ServiceFee",
                "Cost of Advertising",
                "TransactionTotalAmount",
                AllocationCategory.DATA_KIOSK,
            ),
            (
                "other-transaction",
                "other-transaction",
                "StorageRenewalBilling",
                AllocationCategory.DATA_KIOSK,
            ),
            ("other-transaction", "other-transaction", "Fee Adjustment", AllocationCategory.SELBOX),
            (
                "ServiceFee",
                "Refund for Advertiser",
                "TransactionTotalAmount",
                AllocationCategory.SELBOX,
            ),
            ("FBAFees", "Inbound Defect Fee", "Base fee", AllocationCategory.SELBOX),
            (
                "AmazonFees",
                "Eco-contribution for EPR Pay on Behalf - GB",
                "Base fee",
                AllocationCategory.SELBOX,
            ),
        )
        for transaction, amount_type, description, category in rows:
            for amount in ("-7.3", "0", "7.3"):
                with self.subTest(description=description, amount=amount):
                    prepared = prepare_settlement_report(
                        settlement_document(
                            {
                                "transaction-type": transaction,
                                "amount-type": amount_type,
                                "amount-description": description,
                                "amount": amount,
                                "sku": "",
                            }
                        )
                    )
                    row = prepared.transactions[0]
                    self.assertEqual(row.category, category)
                    self.assertEqual(row.amount, Numeric(amount))
                    self.assertEqual(
                        row.family is not None, category is AllocationCategory.DATA_KIOSK
                    )

    def test_invalid_component_of_known_cost_cannot_default_to_selbox(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported Settlement types"):
            prepare_settlement_report(
                settlement_document(
                    {
                        "transaction-type": "FBAFees",
                        "amount-type": "FBA Inventory Storage Fee",
                        "amount-description": "Unknown component",
                        "sku": "",
                    }
                )
            )

    def test_known_family_failures_cannot_fall_through_including_zero_amounts(self) -> None:
        invalid_rows = (
            {"sku": "", "amount": "0"},
            {"marketplace-name": "", "amount-type": "ItemFees", "amount": "0"},
            {"amount-type": "Unsupported"},
            {"amount-description": ""},
            {"transaction-type": "Liquidations Adjustments", "amount-type": "Other"},
            {
                "transaction-type": "AmazonFees",
                "amount-type": "FBA fulfilment fee per unit - Correction",
                "amount-description": "Unknown",
            },
            {
                "transaction-type": "Debt Adjustment",
                "amount-type": "Debt Adjustment",
                "amount-description": "Cross-Account Debt Adjustment for es",
                "sku": "",
            },
            {
                "transaction-type": "other-transaction",
                "amount-type": "other-transaction",
                "amount-description": "Subscription Fee",
            },
            {
                "transaction-type": "other-transaction",
                "amount-type": "other-transaction",
                "amount-description": "Transfer of funds unsuccessful: ",
                "sku": "",
            },
        )
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(ValueError):
                prepare_settlement_report(settlement_document(row))

    def test_native_dates_and_out_of_period_rows_are_preserved_with_diagnostics(self) -> None:
        document = settlement_document(
            {"posted-date": "2026-09-01", "posted-date-time": "2026-09-01T00:00:08+00:00"}
        )
        result = prepare_settlement_report(document)
        self.assertEqual(result.transactions[0].posted_date.isoformat(), "2026-09-01")
        self.assertEqual(
            {item["kind"] for item in result.diagnostics},
            {"POSTED_TIMESTAMP_OUTSIDE_PERIOD", "POSTED_DATE_OUTSIDE_PERIOD"},
        )
        self.assertEqual(result.header.total_amount, Numeric(10))

    def test_offset_comparison_uses_instants_while_posted_date_uses_native_date(self) -> None:
        result = prepare_settlement_report(
            settlement_document(
                {"posted-date": "2026-08-01", "posted-date-time": "2026-08-01T00:30:00+03:00"}
            )
        )
        self.assertEqual(result.transactions[0].posted_date.isoformat(), "2026-08-01")
        self.assertEqual(len(result.diagnostics), 1)
        self.assertEqual(result.diagnostics[0]["kind"], "POSTED_TIMESTAMP_OUTSIDE_PERIOD")

    def test_malformed_inconsistent_dates_identity_and_unknown_marketplace_fail(self) -> None:
        rows = (
            {"posted-date": "not-a-date"},
            {"posted-date": "2026-08-03"},
            {"posted-date-time": "2026-08-02T12:00:00"},
            {"settlement-id": "another"},
            {"marketplace-name": "Unknown"},
            {"quantity-purchased": "1.5"},
            {"quantity-purchased": "9223372036854775808"},
        )
        for row in rows:
            with self.subTest(row=row), self.assertRaises(ValueError):
                prepare_settlement_report(settlement_document(row))

    def test_explicit_non_amazon_name_remains_distinct(self) -> None:
        row = prepare_settlement_report(
            settlement_document({"marketplace-name": "Non-Amazon US"})
        ).transactions[0]
        self.assertEqual(row.marketplace_name, "Non-Amazon US")

    def test_optional_suffix_and_metadata_omission_use_actual_header_order(self) -> None:
        columns = tuple(reversed(SETTLEMENT_V2_COLUMNS))
        result = prepare_settlement_report(settlement_document({}, columns=columns))
        self.assertEqual(result.transactions[0].sku, "SKU-1")
        lines = settlement_document({"quantity-purchased": ""}).decode().splitlines()
        lines[1] = "\t".join(lines[1].split("\t")[:6])
        lines[2] = "\t".join(lines[2].split("\t")[:22])
        result = prepare_settlement_report(("\n".join(lines) + "\n").encode())
        self.assertIsNone(result.transactions[0].quantity)
        self.assertEqual(
            result.diagnostics[1]["omitted_column_names"], ("quantity-purchased", "promotion-id")
        )
        lines[2] = "\t".join(lines[2].split("\t")[:21])
        with self.assertRaisesRegex(ValueError, "SKU"):
            prepare_settlement_report(("\n".join(lines) + "\n").encode())

    def test_validated_source_fields_and_diagnostics_cannot_change_before_publication(self) -> None:
        result = prepare_settlement_report(
            settlement_document(
                {"posted-date": "2026-09-01", "posted-date-time": "2026-09-01T00:00:08+00:00"}
            )
        )
        with self.assertRaises(TypeError):
            cast(dict[str, str], result.transactions[0].source_fields)["sku"] = "changed"
        with self.assertRaises(TypeError):
            cast(dict[str, object], result.diagnostics[0])["kind"] = "changed"

    def test_exact_control_total_ignores_ambient_decimal_context(self) -> None:
        document = settlement_document(
            {"amount": "10000000000000000000000.01"}, {"amount": "-10000000000000000000000"}
        )
        with localcontext() as context:
            context.prec = 2
            self.assertEqual(
                prepare_settlement_report(document).header.total_amount, Numeric("0.01")
            )
        with self.assertRaisesRegex(ValueError, "reconcile"):
            prepare_settlement_report(document.replace(b"\t0.01\tUSD", b"\t0.02\tUSD"))

    def test_retrocharges_require_complete_reviewed_groups_and_exact_tax_pairs(self) -> None:
        defaults = {
            "transaction-type": "Order_Retrocharge",
            "order-id": "order-1",
            "sku": "",
            "marketplace-name": "",
        }
        tax = {**defaults, "amount-description": "Tax", "amount": "3.5"}
        withholding = {
            **defaults,
            "amount-type": "ItemWithheldTax",
            "amount-description": "MarketplaceFacilitatorTax-Principal",
            "amount": "-3.5",
        }
        document = settlement_document(tax, withholding)
        with self.assertRaisesRegex(ValueError, "coverage"):
            prepare_settlement_report(document)
        result = prepare_settlement_report(document, retrocharge_coverage=((3, 4),))
        self.assertEqual(
            [row.category for row in result.transactions], [AllocationCategory.SELBOX] * 2
        )
        for groups in (((3,),), ((3,), (4,)), ((3, 4), (4,)), ((3, 4, 5),)):
            with self.subTest(groups=groups), self.assertRaises(ValueError):
                prepare_settlement_report(document, retrocharge_coverage=groups)
        for malformed in (
            settlement_document(tax),
            settlement_document(tax, {**withholding, "amount": "-3.4"}),
            settlement_document(tax, {**withholding, "order-id": "different"}),
            settlement_document(
                tax, {**withholding, "amount-description": "MarketplaceFacilitatorTax-Shipping"}
            ),
        ):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                prepare_settlement_report(malformed, retrocharge_coverage=((3, 4),))

    def test_workflow_publishes_source_facts_with_amazon_disabled_and_retains_failed_input(
        self,
    ) -> None:
        storage = MemoryArchiveStorage()
        acquisition = settlement_acquisition(settlement_document({}), storage)
        database = FakeDatabaseConnection()
        with (
            patch(
                "services.sync.src.settlement_preprocess.workflow.load_settlement_acquisition",
                return_value=acquisition,
            ),
            patch(
                "services.sync.src.settlement_preprocess.workflow.settlement_current_versions",
                return_value={},
            ),
            patch(
                "services.sync.src.settlement_preprocess.workflow.publish_settlement",
                return_value="version-1",
            ) as publish,
            patch("socket.create_connection", side_effect=AssertionError("Network unavailable")),
        ):
            self.assertEqual(
                preprocess_settlement_report(database, storage, str(acquisition.id)), "version-1"
            )
            self.assertEqual(len(publish.call_args.args[2].transactions), 1)
            publish.reset_mock()
            broken = replace(acquisition.document, archive_sha256="0" * 64)
            with (
                patch(
                    "services.sync.src.settlement_preprocess.workflow.load_settlement_acquisition",
                    return_value=replace(acquisition, document=broken),
                ),
                self.assertLogs("services.sync.src.settlement_preprocess.workflow", level="ERROR"),
                self.assertRaises(ValueError),
            ):
                preprocess_settlement_report(database, storage, str(acquisition.id))
            publish.assert_not_called()
        self.assertEqual(len(storage.objects), 1)
