"""Both source classifiers must agree on the authority of reviewed economic families.

The sources can report different dates and amounts. These checks compare category
decisions, not individual transactions or monetary totals.
"""

import unittest
from collections import defaultdict
from dataclasses import replace

from ...src.allocation import AllocationCategory
from ...src.data_kiosk_economics.components import build_components, classify_fee
from ...src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from ...src.settlement_preprocess.classification import classify_settlement_row
from ...src.settlement_preprocess.cost_families import (
    _NAMED_COSTS,  # pyright: ignore[reportPrivateUsage]
    _OTHER_COSTS,  # pyright: ignore[reportPrivateUsage]
)
from ..support.economics import complete_economics_fact

# Reviewed family correspondence; the raw names need not match across sources.
_DATA_KIOSK_COST_LABELS = {
    "ADVERTISING": ("SponsoredProductFee",),
    "AGED_STORAGE": ("LongTermStorageFee", "FbaAgedInventorySurcharge"),
    "COUPON": ("CouponParticipationFee", "CouponPerformanceFee"),
    "DEAL": ("DealParticipationFee", "DealPerformanceFee"),
    "DISPOSAL": ("DisposalFee",),
    "INBOUND_PLACEMENT": ("FbaInboundConvenienceFee", "FbaInboundPlacementServiceFee"),
    "INBOUND_TRANSPORTATION": ("FbaInboundTransportationFee",),
    "INBOUND_TRANSPORTATION_PROGRAM": ("FbaInboundTransportationProgramFee",),
    "REMOVAL": ("RemovalFee",),
    "STORAGE": ("FbaStorageFee", "MonthlyInventoryStorageFee"),
}


def _settlement_category(
    transaction: str, amount_type: str, description: str, *, sku: str = "SKU-1"
) -> AllocationCategory:
    category, _, _, _ = classify_settlement_row(
        {
            "transaction-type": transaction,
            "amount-type": amount_type,
            "amount-description": description,
            "marketplace-name": "Amazon.com",
            "sku": sku,
        }
    )
    return category


class SourceCategoryAlignmentTests(unittest.TestCase):
    def test_every_reviewed_settlement_cost_family_agrees_with_data_kiosk(self) -> None:
        # Inspect the private registries to require coverage when their families change.
        settlement_costs: defaultdict[str, list[tuple[str, str, str]]] = defaultdict(list)
        for (transaction, amount_type), cost in _NAMED_COSTS.items():
            settlement_costs[cost.name].extend(
                (transaction, amount_type, description) for description in cost.descriptions
            )
        for description, family in _OTHER_COSTS.items():
            settlement_costs[family].append(("other-transaction", "other-transaction", description))

        # A new Settlement family must add a reviewed Data Kiosk correspondence.
        self.assertEqual(set(settlement_costs), set(_DATA_KIOSK_COST_LABELS))
        fact = complete_economics_fact()
        for family, triples in settlement_costs.items():
            for triple in triples:
                for sku in ("", " SKU-1 "):
                    with self.subTest(family=family, settlement=triple, sku=sku):
                        self.assertIs(
                            _settlement_category(*triple, sku=sku), AllocationCategory.DATA_KIOSK
                        )
            for label in _DATA_KIOSK_COST_LABELS[family]:
                if family == "ADVERTISING":
                    candidate = replace(
                        fact, fees=(), ads=(replace(fact.ads[0], ad_type_name=label),), cost=None
                    )
                else:
                    candidate = replace(
                        fact, fees=(replace(fact.fees[0], fee_type_name=label),), ads=(), cost=None
                    )
                with self.subTest(family=family, data_kiosk=label):
                    sale, cost_component = build_components(candidate)
                    self.assertIs(sale.category, AllocationCategory.SETTLEMENT)
                    self.assertIs(cost_component.category, AllocationCategory.DATA_KIOSK)
                    self.assertEqual(cost_component.sku, candidate.msku)

    def test_settlement_owned_fees_remain_comparison_components_in_data_kiosk(self) -> None:
        families = (
            ("Order", "ItemFees", "Commission", "ReferralFee"),
            ("Order", "ItemFees", "FBAPerUnitFulfillmentFee", "FbaFulfilmentFee"),
            ("Order", "ItemFees", "DigitalServicesFee", "DigitalServicesFeeFBA"),
            ("Order", "ItemFees", "DigitalServicesFee", "DigitalServicesFeeSOA"),
            ("Refund", "ItemFees", "Commission", "RefundedReferralFee"),
            ("Refund", "ItemFees", "RefundCommission", "RefundCommissionFee"),
            ("Liquidations", "ItemFees", "LiquidationsBrokerageFee", "LiquidationProcessingFee"),
            ("Liquidations", "ItemFees", "LiquidationsBrokerageFee", "LiquidationReferralFee"),
        )
        fact = complete_economics_fact()
        for transaction, amount_type, description, label in families:
            with self.subTest(settlement=description, data_kiosk=label):
                settlement = _settlement_category(transaction, amount_type, description)
                candidate = replace(
                    fact, fees=(replace(fact.fees[0], fee_type_name=label),), ads=(), cost=None
                )
                sale, fee = build_components(candidate)
                self.assertIs(settlement, AllocationCategory.SETTLEMENT)
                self.assertIs(fee.category, settlement)
                self.assertIs(sale.category, settlement)

    def test_selbox_meaning_preserves_source_specific_admission_rules(self) -> None:
        self.assertIs(
            _settlement_category(
                "other-transaction", "other-transaction", "Subscription Fee", sku=""
            ),
            classify_fee("SubscriptionFee"),
        )
        self.assertIs(classify_fee("SubscriptionFee"), AllocationCategory.SELBOX)
        fact = complete_economics_fact()
        with self.assertRaisesRegex(ValueError, "MSKU cannot use the SELBOX category"):
            build_components(
                replace(fact, fees=(replace(fact.fees[0], fee_type_name="SubscriptionFee"),))
            )
        self.assertIs(
            _settlement_category("UnreviewedTransaction", "UnknownAmount", "UnknownFee"),
            AllocationCategory.SELBOX,
        )
        with self.assertRaises(UnresolvedDataKioskComponentError):
            classify_fee("UnknownFee")
