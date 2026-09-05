"""Tests for direct-SKU Settlement processing plans."""

import unittest
from dataclasses import replace
from datetime import date

from ....src.numeric import ZERO, Numeric
from ....src.settlement_processing.classification import classify_ledger_entry
from ....src.settlement_processing.models import (
    CategoryMappingRule,
    CompanySkuFeeRateCandidate,
)
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    direct_rules,
    make_id_factory,
    make_ledger_entry,
)


class TestDirectSettlementPlanning(unittest.TestCase):
    def test_first_mapping_rule_wins_and_unmapped_order_sku_stays_direct(self) -> None:
        entry = make_ledger_entry("entry-1", "10.00")
        broad_rule = CategoryMappingRule(
            20,
            None,
            "ItemPrice",
            None,
            "SALES_TAX",
            "SKU_PNL",
        )
        exact_rule = direct_rules()[0]

        classified = classify_ledger_entry(entry, [broad_rule, exact_rule])
        fallback = classify_ledger_entry(
            make_ledger_entry(
                "entry-2",
                "1",
                transaction_type="Order_Retrocharge",
                amount_type="ItemFees",
                amount_description="NewAmazonFee",
            ),
            [],
        )
        missing_sku = classify_ledger_entry(
            make_ledger_entry("entry-3", "10.00", sku=None),
            [exact_rule],
        )

        self.assertEqual(classified.category_code, "PRODUCT_SALES")
        self.assertEqual(fallback.category_code, "UNMAPPED")
        self.assertEqual(fallback.handling_method, "DIRECT_SKU")
        self.assertEqual(missing_sku.category_code, "PRODUCT_SALES")
        self.assertEqual(missing_sku.handling_method, "UNASSIGNED")

    def test_unmapped_sku_with_unsupported_amount_type_stays_unassigned(self) -> None:
        classified = classify_ledger_entry(
            make_ledger_entry(
                "entry-1",
                "1",
                transaction_type="MysteryTransaction",
                amount_type="MysteryAmount",
                amount_description="MysteryDescription",
            ),
            [],
        )

        self.assertEqual(classified.category_code, "UNMAPPED")
        self.assertEqual(classified.handling_method, "UNASSIGNED")

    def test_missing_sku_direct_rule_yields_to_usable_auxiliary_rule(self) -> None:
        direct_rule = direct_rules()[0]
        auxiliary_rule = CategoryMappingRule(
            20,
            "Order",
            "ItemPrice",
            "Principal",
            "ADVERTISING_COST",
            "SKU_PNL",
            "DATA_KIOSK",
        )

        classified = classify_ledger_entry(
            make_ledger_entry("entry-1", "1", sku=None),
            [direct_rule, auxiliary_rule],
        )

        self.assertEqual(classified.category_code, "ADVERTISING_COST")
        self.assertEqual(classified.handling_method, "AUXILIARY_EVIDENCE")
        self.assertEqual(classified.preferred_auxiliary_source, "DATA_KIOSK")

    def test_direct_categories_reconcile_and_keep_selbox_fee_on_sales(self) -> None:
        entries = [
            make_ledger_entry("entry-1", "10.00"),
            make_ledger_entry(
                "entry-2",
                "-2.00",
                amount_type="Promotion",
                amount_description="Principal",
            ),
            make_ledger_entry(
                "entry-3",
                "-1.00",
                amount_type="ItemFees",
                amount_description="Commission",
            ),
        ]
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="fee-rate-1",
            company_id="company-1",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            valid_from=date(2026, 8, 1),
            valid_to=date(2026, 9, 1),
            fee_rate_percent=Numeric(10),
        )

        allocation_groups = build_test_allocation_groups(
            entries,
            direct_rules(),
            [fee_rate],
            id_factory=make_id_factory(),
        )

        groups = {group.category_code: group for group in allocation_groups}
        self.assertEqual(set(groups), {"PRODUCT_SALES", "PROMOTIONAL_REBATES", "REFERRAL_FEES"})
        self.assertEqual(sum((group.settlement_amount for group in allocation_groups), ZERO), 7)
        sales = groups["PRODUCT_SALES"].targets[0]
        self.assertEqual(sales.company_id, "company-1")
        self.assertEqual(sales.elaborated_amount, Numeric(10))
        self.assertEqual(sales.difference_amount, ZERO)
        self.assertEqual(sales.selbox_fee, Numeric(-1))
        self.assertEqual(sales.settlement_amount + sales.selbox_fee, Numeric(9))
        for group in allocation_groups:
            target = group.targets[0]
            self.assertEqual(target.settlement_quantity, Numeric(1))
            self.assertEqual(target.elaborated_quantity, Numeric(1))
            self.assertEqual(target.company_payable_quantity, Numeric(1))
            if group.category_code == "PRODUCT_SALES":
                self.assertEqual(target.selbox_fee_base_quantity, Numeric(1))
                self.assertEqual(target.selbox_fee_quantity, Numeric(1))
            else:
                self.assertEqual(target.selbox_fee, ZERO)
                self.assertIsNone(target.selbox_fee_base_quantity)
                self.assertIsNone(target.selbox_fee_quantity)
        self.assertEqual(groups["PRODUCT_SALES"].ledger_entry_ids, ("entry-1",))

    def test_order_grain_does_not_split_on_adjustment_or_shipment_ids(self) -> None:
        first = make_ledger_entry(
            "entry-1",
            "10.00",
            adjustment_id="adjustment-1",
            shipment_id="shipment-1",
        )
        second = replace(
            first,
            id="entry-2",
            settlement_report_line_id="raw-entry-2",
            settlement_amount=Numeric("1.000000"),
            amazon_adjustment_id="adjustment-2",
            amazon_shipment_id="shipment-2",
        )

        allocation_groups = build_test_allocation_groups(
            [first, second],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        self.assertEqual(len(allocation_groups), 1)
        self.assertIsNone(allocation_groups[0].amazon_adjustment_id)
        self.assertIsNone(allocation_groups[0].amazon_shipment_id)

    def test_zero_rate_or_fee_base_produces_unsigned_zero_fee(self) -> None:
        for amount_type, amount_description, rate in (
            ("ItemPrice", "Principal", Numeric(0)),
            ("ItemFees", "Commission", Numeric(10)),
        ):
            with self.subTest(amount_type=amount_type, rate=rate):
                fee_rate = CompanySkuFeeRateCandidate(
                    company_sku_fee_rate_id="fee-rate-1",
                    company_id="company-1",
                    marketplace_id="ATVPDKIKX0DER",
                    amz_sku="SKU-1",
                    valid_from=date(2026, 8, 1),
                    valid_to=None,
                    fee_rate_percent=rate,
                )
                allocation_groups = build_test_allocation_groups(
                    [
                        make_ledger_entry(
                            "entry-1",
                            "1",
                            amount_type=amount_type,
                            amount_description=amount_description,
                        )
                    ],
                    direct_rules(),
                    [fee_rate],
                    id_factory=make_id_factory(),
                )

                self.assertEqual(
                    allocation_groups[0].targets[0].selbox_fee.value.as_tuple(),
                    ZERO.value.as_tuple(),
                )

    def test_direct_group_tolerates_sparse_marketplace_lines(self) -> None:
        """Resolve blank category marketplace fields from the same order/SKU."""
        sale = make_ledger_entry("entry-1", "10.00")
        fee = replace(
            sale,
            id="entry-2",
            settlement_report_line_id="raw-entry-2",
            settlement_amount=Numeric("-1.000000"),
            amount_type="ItemFees",
            amount_description="Commission",
            marketplace_id=None,
            marketplace_name=None,
        )

        allocation_groups = build_test_allocation_groups(
            [sale, fee],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        self.assertEqual(len(allocation_groups), 2)
        for group in allocation_groups:
            self.assertEqual(group.marketplace_id, "ATVPDKIKX0DER")
            self.assertEqual(group.targets[0].marketplace_id, "ATVPDKIKX0DER")

    def test_direct_group_rejects_conflicting_marketplaces(self) -> None:
        """Check contradictory nonblank marketplace evidence fails closed."""
        first = make_ledger_entry("entry-1", "10.00")
        second = replace(
            first,
            id="entry-2",
            settlement_report_line_id="raw-entry-2",
            marketplace_id="A1PA6795UKMFR9",
            marketplace_name="Amazon.de",
        )

        with self.assertRaisesRegex(ValueError, "conflicting marketplace_id"):
            build_test_allocation_groups(
                [first, second],
                direct_rules(),
                id_factory=make_id_factory(),
            )

    def test_missing_company_mapping_keeps_direct_settlement_explanation(self) -> None:
        entry = make_ledger_entry("entry-1", "10.00", order_id=None)

        allocation_groups = build_test_allocation_groups(
            [entry],
            direct_rules(),
            id_factory=make_id_factory(),
        )

        group = allocation_groups[0]
        target = group.targets[0]
        self.assertIsNone(group.amazon_order_id)
        self.assertEqual(group.handling_method, "DIRECT_SKU")
        self.assertIsNone(target.company_id)
        self.assertEqual(target.amz_sku, "SKU-1")
        self.assertEqual(target.join_method, "DIRECT_SETTLEMENT")
        self.assertEqual(target.unassigned_reason, "MISSING_COMPANY_ASSIGNMENT")
        self.assertEqual(target.elaborated_amount, Numeric("10.000000"))
        self.assertEqual(target.difference_amount, ZERO)

    def test_fee_rate_period_is_resolved_at_posted_date(self) -> None:
        entry = make_ledger_entry("entry-1", "10.00")
        expired_fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="fee-rate-1",
            company_id="company-1",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            valid_from=date(2026, 8, 1),
            valid_to=entry.posted_date,
            fee_rate_percent=Numeric(0),
        )

        expired_fee_rate_groups = build_test_allocation_groups(
            [entry],
            direct_rules(),
            [expired_fee_rate],
            id_factory=make_id_factory(),
        )
        expired_fee_rate_target = expired_fee_rate_groups[0].targets[0]
        self.assertIsNone(expired_fee_rate_target.company_id)
        self.assertEqual(
            expired_fee_rate_target.unassigned_reason,
            "MISSING_COMPANY_ASSIGNMENT",
        )


if __name__ == "__main__":
    unittest.main()
