"""Component authority, exact economic amounts, and semantic comparison."""

import unittest
from dataclasses import replace

from ....src.allocation import AllocationCategory
from ....src.amazon.data_kiosk.economics_models import (
    EconomicsFeeComponent,
    EconomicsProperty,
)
from ....src.data_kiosk_economics.comparison import comparable_components
from ....src.data_kiosk_economics.components import build_components, classify_fee
from ....src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from ....src.numeric import Numeric
from ....src.source_serialization import content_sha256
from ...support.economics import complete_economics_fact


class DataKioskComponentTests(unittest.TestCase):
    def test_seller_entered_costs_keep_source_signs_and_remain_analysis_only(self) -> None:
        fact = complete_economics_fact()
        rows = build_components(replace(fact, fees=(), ads=()))
        self.assertEqual(
            [(row.component_type, row.amount, row.category) for row in rows],
            [
                ("NET_PRODUCT_SALES", Numeric("20.25"), AllocationCategory.SETTLEMENT),
                ("COST_OF_GOODS_SOLD", Numeric("4.125"), AllocationCategory.ANALYSIS_ONLY),
                ("SHIPPING_TO_AMAZON_COST", Numeric("0.625"), AllocationCategory.ANALYSIS_ONLY),
            ],
        )
        self.assertEqual([row.fee_base for row in rows], [Numeric("20.25"), None, None])
        self.assertEqual([row.quantity for row in rows], [Numeric(2), None, None])

    def test_explicit_component_maps_accept_only_reviewed_labels(self) -> None:
        for label in (
            "ReferralFee",
            "FbaFulfilmentFee",
            "RefundedReferralFee",
            "RefundCommissionFee",
            "FBAInventoryReimbursement",
            "LiquidationProcessingFee",
            "LiquidationReferralFee",
        ):
            with self.subTest(label=label):
                self.assertEqual(classify_fee(label), AllocationCategory.SETTLEMENT)
        self.assertEqual(classify_fee("SubscriptionFee"), AllocationCategory.SELBOX)
        for label in (
            "DisposalFee",
            "RemovalFee",
            "LabelingFee",
            "LongTermStorageFee",
            "FbaStorageFee",
            "FbaInboundConvenienceFee",
            "FbaInboundTransportationFee",
            "CouponParticipationFee",
            "CouponPerformanceFee",
            "DealParticipationFee",
            "DealPerformanceFee",
        ):
            with self.subTest(label=label):
                self.assertEqual(classify_fee(label), AllocationCategory.DATA_KIOSK)
        with self.assertRaises(UnresolvedDataKioskComponentError):
            classify_fee("UnknownFee")

    def test_tax_promotion_and_credits_use_total_once_and_keep_original_breakdown(self) -> None:
        fact = complete_economics_fact()
        fee = fact.fees[0]
        detail = replace(
            fee.aggregated_detail,
            amount=replace(fee.aggregated_detail.amount, amount=Numeric("6")),
            promotion_amount=replace(fee.aggregated_detail.amount, amount=Numeric("1")),
            tax_amount=replace(fee.aggregated_detail.amount, amount=Numeric("0.6")),
            total_amount=replace(fee.aggregated_detail.amount, amount=Numeric("5.6")),
        )
        selected_fee = replace(fee, fee_type_name="FbaStorageFee", aggregated_detail=detail)
        row = build_components(replace(fact, fees=(selected_fee,), ads=(), cost=None))[1]
        self.assertEqual(row.amount, Numeric("-5.6"))
        credit_detail = replace(
            detail,
            amount=replace(detail.amount, amount=Numeric("-6")),
            promotion_amount=replace(detail.promotion_amount, amount=Numeric(0)),
            tax_amount=replace(detail.tax_amount, amount=Numeric(0)),
            total_amount=replace(detail.total_amount, amount=Numeric("-6")),
        )
        self.assertEqual(
            build_components(
                replace(
                    fact,
                    fees=(replace(selected_fee, aggregated_detail=credit_detail),),
                    ads=(),
                    cost=None,
                )
            )[1].amount,
            Numeric(6),
        )
        with self.assertRaisesRegex(ValueError, "totalAmount"):
            build_components(
                replace(
                    fact,
                    fees=(
                        replace(
                            selected_fee,
                            aggregated_detail=replace(
                                detail,
                                total_amount=replace(detail.total_amount, amount=Numeric(10)),
                            ),
                        ),
                    ),
                )
            )

    def test_full_content_comparison_ignores_provenance_and_unordered_arrays(self) -> None:
        fact = complete_economics_fact()
        properties = (EconomicsProperty("Volume", "1"), EconomicsProperty("Size", "small"))
        detail = fact.fees[0].aggregated_detail
        components = (
            EconomicsFeeComponent("Base", detail, properties),
            EconomicsFeeComponent("Other", detail, ()),
        )
        fee = replace(fact.fees[0], properties=properties, components=components)
        first = replace(fact, fees=(fee,), ads=(), cost=None)
        second_fee = replace(
            fee, properties=tuple(reversed(properties)), components=tuple(reversed(components))
        )
        second = replace(
            first,
            source_document_id="another-query-document",
            source_line_number=99,
            document_sha256="f" * 64,
            fees=(second_fee,),
        )
        self.assertEqual(
            content_sha256(comparable_components(build_components(first))),
            content_sha256(comparable_components(build_components(second))),
        )
        changed_detail = replace(
            detail,
            amount=replace(detail.amount, amount=detail.amount.amount + 1),
            promotion_amount=replace(
                detail.promotion_amount, amount=detail.promotion_amount.amount + 1
            ),
        )
        changed = replace(first, fees=(replace(fee, aggregated_detail=changed_detail),))
        self.assertEqual(build_components(first)[1].amount, build_components(changed)[1].amount)
        self.assertNotEqual(
            content_sha256(comparable_components(build_components(first))),
            content_sha256(comparable_components(build_components(changed))),
        )

    def test_fee_identity_includes_native_subperiod_and_rejects_duplicate_components(self) -> None:
        fact = complete_economics_fact()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            build_components(replace(fact, fees=(fact.fees[0], fact.fees[0])))
        different = replace(fact.fees[0], start_date=None, end_date=None)
        rows = build_components(replace(fact, fees=(fact.fees[0], different), ads=(), cost=None))
        self.assertEqual(len(rows), 3)
        self.assertNotEqual(rows[1].component_key, rows[2].component_key)
