"""Reviewed exact Settlement source components; unknown triples are rejected.

Evidence: seed.real, settlement_classification_audit_2026-09-08.json and the
reviewed source-cost/retrocharge policies. Preserve stored component keys and
allocation decisions. New variants require an explicit review and registry edit.
"""

from dataclasses import dataclass
from types import MappingProxyType

from ..allocation import AllocationCategory


@dataclass(frozen=True, slots=True)
class SettlementType:
    transaction_type: str
    amount_type: str
    description: str
    category: AllocationCategory
    family: str | None
    accounting_subtype: str | None

    @property
    def source_key(self) -> tuple[str, str, str]:
        return self.transaction_type, self.amount_type, self.description

    @property
    def component_type(self) -> str:
        if self.amount_type == "ItemPrice" and self.description == "Principal":
            if self.transaction_type == "Order":
                return "PRODUCT_SALES"
            if self.transaction_type == "Refund":
                return "PRODUCT_REFUNDS"
        return "/".join(self.source_key)


def _types(
    transaction: str,
    amount_type: str,
    descriptions: tuple[str, ...],
    *,
    category: AllocationCategory,
    family: str | None = None,
    accounting_subtype: str | None = None,
) -> tuple[SettlementType, ...]:
    return tuple(
        SettlementType(transaction, amount_type, description, category, family, accounting_subtype)
        for description in descriptions
    )


SETTLEMENT_TYPES: tuple[SettlementType, ...] = (
    *_types(
        "ServiceFee",
        "Cost of Advertising",
        ("TransactionTotalAmount",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_ADVERTISING",
    ),
    *_types(
        "FBAFees",
        "FBA Long Term Storage Fee",
        (
            "Base fee",
            "Tax on fee",
        ),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_AGED_STORAGE",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("StorageRenewalBilling",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_AGED_STORAGE",
    ),
    *_types(
        "AmazonFees",
        "Coupon Participation Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_COUPON",
    ),
    *_types(
        "AmazonFees",
        "Coupon Performance Based Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_COUPON",
    ),
    *_types(
        "AmazonFees",
        "Deal Participation Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_DEAL",
    ),
    *_types(
        "AmazonFees",
        "Deal Performance Based Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_DEAL",
    ),
    *_types(
        "FBAFees",
        "FBA Removal Order: Disposal Fee",
        (
            "Base fee",
            "Tax on fee",
        ),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_DISPOSAL",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("DisposalComplete",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_DISPOSAL",
    ),
    *_types(
        "FBAFees",
        "FBA Inbound Placement Service Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_PLACEMENT",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("FBA Inbound Placement Service Fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_PLACEMENT",
    ),
    *_types(
        "FBAFees",
        "FBA Amazon-Partnered Carrier Shipment Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_TRANSPORTATION",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        (
            "FBAInboundTransportationFee",
            "Inbound Transportation Fee",
        ),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_TRANSPORTATION",
    ),
    *_types(
        "FBAFees",
        "Inbound Transportation Program Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_TRANSPORTATION_PROGRAM",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("FBAInboundTransportationProgramFee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_INBOUND_TRANSPORTATION_PROGRAM",
    ),
    *_types(
        "FBAFees",
        "FBA Removal Order: Return Fee",
        ("Base fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_REMOVAL",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("RemovalComplete",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_REMOVAL",
    ),
    *_types(
        "FBAFees",
        "FBA Inventory Storage Fee",
        (
            "Base fee",
            "Tax on fee",
        ),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_STORAGE",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("Storage Fee",),
        category=AllocationCategory.DATA_KIOSK,
        family="C3_STORAGE",
    ),
    *_types(
        "AmazonFees",
        "Amazon service fee for EPR Pay on Behalf - GB - Packaging - "
        "(Period 01.07.2024 - 31.12.2024)",
        ("Base fee",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "AmazonFees",
        "Eco-contribution for EPR Pay on Behalf - GB",
        ("Base fee",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "AmazonFees",
        "Eco-contribution for EPR Pay on Behalf - GB - Packaging - "
        "(Period 01.07.2024 - 31.12.2024)",
        ("Base fee",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "AmazonFees",
        "Vine Enrollment Fee",
        ("Base fee",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "FBAFees",
        "Inbound Defect Fee",
        ("Base fee",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "ServiceFee",
        "Refund for Advertiser",
        ("TransactionTotalAmount",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "Other",
        "MCF Preferred Pricing Seller Credit",
        ("Base charge",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("Fee Adjustment",),
        category=AllocationCategory.SELBOX,
    ),
    *_types(
        "Debt Adjustment",
        "Debt Adjustment",
        (
            "Cross-Account Debt Adjustment against BE",
            "Cross-Account Debt Adjustment against BE, ES",
            "Cross-Account Debt Adjustment against BE, ES, NL",
            "Cross-Account Debt Adjustment against BE, FR, ES",
            "Cross-Account Debt Adjustment against BE, FR, ES, NL",
            "Cross-Account Debt Adjustment against BE, NL",
            "Cross-Account Debt Adjustment against BE, NL, ES",
            "Cross-Account Debt Adjustment against DE",
            "Cross-Account Debt Adjustment against DE, BE, ES",
            "Cross-Account Debt Adjustment against DE, ES, NL",
            "Cross-Account Debt Adjustment against DE, FR",
            "Cross-Account Debt Adjustment against DE, NL, ES",
            "Cross-Account Debt Adjustment against ES",
            "Cross-Account Debt Adjustment against ES, NL",
            "Cross-Account Debt Adjustment against FR",
            "Cross-Account Debt Adjustment against NL, ES",
            "Cross-Account Debt Adjustment for BE",
            "Cross-Account Debt Adjustment for DE",
            "Cross-Account Debt Adjustment for ES",
            "Cross-Account Debt Adjustment for FR",
            "Cross-Account Debt Adjustment for IT",
            "Cross-Account Debt Adjustment for NL",
        ),
        category=AllocationCategory.SELBOX,
        family="F5",
        accounting_subtype="BALANCE_MOVEMENT",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        (
            "Current Reserve Amount",
            "Payable to Amazon",
            "Previous Reserve Amount Balance",
            "Successful charge",
            "Transfer of funds unsuccessful: We could not transfer funds to your bank account "
            "because the account information on file is invalid. "
            "Please update your bank account information.",
        ),
        category=AllocationCategory.SELBOX,
        family="F6",
        accounting_subtype="BALANCE_MOVEMENT",
    ),
    *_types(
        "other-transaction",
        "other-transaction",
        ("Subscription Fee",),
        category=AllocationCategory.SELBOX,
        family="F6",
        accounting_subtype="OPERATING_EXPENSE",
    ),
    *_types(
        "Order_Retrocharge",
        "ItemPrice",
        (
            "ShippingTax",
            "Tax",
        ),
        category=AllocationCategory.SELBOX,
        family="F7",
        accounting_subtype="TAX_RECLASSIFICATION",
    ),
    *_types(
        "Order_Retrocharge",
        "ItemWithheldTax",
        (
            "MarketplaceFacilitatorTax-Principal",
            "MarketplaceFacilitatorTax-Shipping",
            "MarketplaceFacilitatorVAT-Principal",
            "MarketplaceFacilitatorVAT-Shipping",
        ),
        category=AllocationCategory.SELBOX,
        family="F7",
        accounting_subtype="TAX_RECLASSIFICATION",
    ),
    *_types(
        "Refund_Retrocharge",
        "ItemPrice",
        (
            "ShippingTax",
            "Tax",
        ),
        category=AllocationCategory.SELBOX,
        family="F7",
        accounting_subtype="TAX_RECLASSIFICATION",
    ),
    *_types(
        "Refund_Retrocharge",
        "ItemWithheldTax",
        (
            "MarketplaceFacilitatorTax-Principal",
            "MarketplaceFacilitatorTax-Shipping",
            "MarketplaceFacilitatorVAT-Principal",
            "MarketplaceFacilitatorVAT-Shipping",
        ),
        category=AllocationCategory.SELBOX,
        family="F7",
        accounting_subtype="TAX_RECLASSIFICATION",
    ),
    *_types(
        "Order",
        "ItemFees",
        (
            "Commission",
            "Digital Services Fee",
            "DigitalServicesFee",
            "FBAPerUnitFulfillmentFee",
            "ShippingChargeback",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Order",
        "ItemPrice",
        (
            "Principal",
            "Shipping",
            "ShippingTax",
            "Tax",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Order",
        "ItemWithheldTax",
        (
            "LowValueGoodsTax-Principal",
            "LowValueGoodsTax-Shipping",
            "MarketplaceFacilitatorTax-Principal",
            "MarketplaceFacilitatorTax-Shipping",
            "MarketplaceFacilitatorVAT-Principal",
            "MarketplaceFacilitatorVAT-Shipping",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Order",
        "Promotion",
        (
            "Principal",
            "Shipping",
            "TaxDiscount",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Refund",
        "ItemFees",
        (
            "Commission",
            "DigitalServicesFee",
            "RefundCommission",
            "ShippingChargeback",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Refund",
        "ItemPrice",
        (
            "Principal",
            "RestockingFee",
            "Shipping",
            "ShippingTax",
            "Tax",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Refund",
        "ItemWithheldTax",
        (
            "MarketplaceFacilitatorTax-Other",
            "MarketplaceFacilitatorTax-Principal",
            "MarketplaceFacilitatorTax-Shipping",
            "MarketplaceFacilitatorVAT-Principal",
            "MarketplaceFacilitatorVAT-Shipping",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Refund",
        "Promotion",
        (
            "Principal",
            "Shipping",
            "TaxDiscount",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F1",
    ),
    *_types(
        "Liquidations",
        "ItemFees",
        ("LiquidationsBrokerageFee",),
        category=AllocationCategory.SETTLEMENT,
        family="F2",
    ),
    *_types(
        "Liquidations",
        "ItemPrice",
        (
            "Principal",
            "Tax",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F2",
    ),
    *_types(
        "Liquidations Adjustments",
        "ItemFees",
        ("LiquidationsBrokerageFee",),
        category=AllocationCategory.SETTLEMENT,
        family="F2",
    ),
    *_types(
        "Liquidations Adjustments",
        "ItemPrice",
        (
            "Principal",
            "Tax",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F2",
    ),
    *_types(
        "other-transaction",
        "FBA Inventory Reimbursement",
        (
            "COMPENSATED_CLAWBACK",
            "FREE_REPLACEMENT_REFUND_ITEMS",
            "REVERSAL_REIMBURSEMENT",
            "WAREHOUSE_DAMAGE",
            "WAREHOUSE_LOST",
        ),
        category=AllocationCategory.SETTLEMENT,
        family="F3",
    ),
    *_types(
        "AmazonFees",
        "FBA fulfilment fee per unit - Correction",
        ("Base fee",),
        category=AllocationCategory.SETTLEMENT,
        family="F4",
    ),
    *_types(
        "AmazonFees",
        "FBA fulfilment fee per unit - Reversal",
        ("Base fee",),
        category=AllocationCategory.SETTLEMENT,
        family="F4",
    ),
)

SETTLEMENT_TYPE_BY_SOURCE = MappingProxyType({item.source_key: item for item in SETTLEMENT_TYPES})
