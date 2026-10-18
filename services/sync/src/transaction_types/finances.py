"""Explicit native Finances component mapping; unknown monetary paths fail closed."""

from dataclasses import dataclass
from types import MappingProxyType

from ..allocation import AllocationCategory


@dataclass(frozen=True, slots=True)
class FinancesType:
    component_type: str
    category: AllocationCategory
    accounting_subtype: str | None = None


_FINANCIAL = (
    "PRODUCT_SALES",
    "PRODUCT_REFUNDS",
    "SHIPPING_CREDITS",
    "SHIPPING_REFUNDS",
    "GIFT_WRAP_CREDITS",
    "GIFT_WRAP_TAX",
    "GIFT_WRAP_CHARGEBACKS",
    "PRODUCT_TAX",
    "SHIPPING_TAX",
    "TAX_WITHHELD",
    "PROMOTIONAL_REBATES",
    "PROMOTIONAL_REFUNDS",
    "POINTS",
    "REFERRAL_FEES",
    "REFUNDED_REFERRAL_FEES",
    "FBA_FULFILLMENT_FEES",
    "SHIPPING_CHARGEBACKS",
    "REFUND_COMMISSION",
    "RESTOCKING",
    "INVENTORY_REIMBURSEMENTS",
    "INVENTORY_REIMBURSEMENT_REVERSALS",
    "LIQUIDATION_PROCEEDS",
    "LIQUIDATION_FEES",
    "FULFILLMENT_FEE_CORRECTIONS",
    "FULFILLMENT_FEE_REVERSALS",
    "DIGITAL_SERVICES_FEES",
    "ZERO_ACTIVITY",
)
_COSTS = (
    "ADVERTISING",
    "STORAGE_FEES",
    "AGED_STORAGE_FEES",
    "DISPOSAL_FEES",
    "REMOVAL_FEES",
    "INBOUND_PLACEMENT_FEES",
    "INBOUND_TRANSPORTATION_FEES",
    "INBOUND_TRANSPORTATION_PROGRAM_FEES",
    "LABELING_FEES",
    "COUPON_FEES",
    "DEAL_FEES",
)
_ACCOUNT = (
    "SUBSCRIPTION_FEES",
    "EPR_FEES",
    "INBOUND_DEFECT_FEES",
    "MCF_CREDITS",
    "VINE_FEES",
    "OTHER_ADJUSTMENTS",
)
_BALANCE = ("DEBT_RECOVERY", "CROSS_ACCOUNT_ADJUSTMENTS", "RESERVE_MOVEMENTS", "BANK_TRANSFERS")
FINANCES_TYPES = (
    *(FinancesType(name, AllocationCategory.FINANCES) for name in _FINANCIAL),
    *(FinancesType(name, AllocationCategory.DATA_KIOSK) for name in _COSTS),
    *(FinancesType(name, AllocationCategory.SELBOX, "OPERATING_EXPENSE") for name in _ACCOUNT),
    *(FinancesType(name, AllocationCategory.SELBOX, "BALANCE_MOVEMENT") for name in _BALANCE),
    FinancesType("TAX_RECLASSIFICATION", AllocationCategory.SELBOX, "TAX_RECLASSIFICATION"),
)
_BY_NAME = {item.component_type: item for item in FINANCES_TYPES}


def _mapping() -> dict[tuple[str, tuple[str, ...]], FinancesType]:
    result: dict[tuple[str, tuple[str, ...]], FinancesType] = {}

    def add(kind: str, path: tuple[str, ...], name: str) -> None:
        result[kind, path] = _BY_NAME[name]

    for kind in ("Shipment", "Refund"):
        refund = kind == "Refund"
        add(
            kind,
            ("ProductCharges", "OurPricePrincipal"),
            "PRODUCT_REFUNDS" if refund else "PRODUCT_SALES",
        )
        add(
            kind,
            ("Shipping", "ShippingPrincipal"),
            "SHIPPING_REFUNDS" if refund else "SHIPPING_CREDITS",
        )
        for name in ("OurPriceDiscount", "ShippingDiscount"):
            add(
                kind,
                ("PromoRebates", name),
                "PROMOTIONAL_REFUNDS" if refund else "PROMOTIONAL_REBATES",
            )
        add(kind, ("Points", "PointsReclaimed" if refund else "PointsGranted"), "POINTS")
        for name in (
            "OurPriceTax",
            "OurPriceTaxDiscount",
            "ShippingTax",
            "ShippingTaxDiscount",
            "MarketplaceFacilitatorTax-Principal",
            "MarketplaceFacilitatorTax-Shipping",
            "MarketplaceFacilitatorVAT-Principal",
            "MarketplaceFacilitatorVAT-Shipping",
            "LowValueGoodsTax-Principal",
            "LowValueGoodsTax-Shipping",
        ):
            semantic = (
                "TAX_WITHHELD"
                if name.startswith(("Marketplace", "LowValue"))
                else ("SHIPPING_TAX" if name.startswith("Shipping") else "PRODUCT_TAX")
            )
            add(kind, ("Tax", name), semantic)
        for fee, semantic in {
            "Commission": "REFUNDED_REFERRAL_FEES" if refund else "REFERRAL_FEES",
            "FBAPerUnitFulfillmentFee": "FBA_FULFILLMENT_FEES",
            "ShippingChargeback": "SHIPPING_CHARGEBACKS",
            "RefundCommission": "REFUND_COMMISSION",
        }.items():
            for detail in ("Base", "Tax", "Promo"):
                add(kind, ("AmazonFees", fee, detail), semantic)
        for fee in ("DigitalServicesFee", "DigitalServicesFeeFBA"):
            for detail in ("Base", "Tax"):
                add(kind, ("DigitalServicesFee", fee, detail), "DIGITAL_SERVICES_FEES")
        add(kind, (), "ZERO_ACTIVITY")
    for name in ("PointsDeductionPrincipal", "RestockingDeductionPrincipal"):
        add("Refund", ("Other", name), "POINTS" if name.startswith("Points") else "RESTOCKING")
    add("Shipment", ("Other", "GiftwrapPrincipal"), "GIFT_WRAP_CREDITS")
    add("Shipment", ("Tax", "GiftwrapTax"), "GIFT_WRAP_TAX")
    for detail in ("Base", "Tax"):
        add("Shipment", ("AmazonFees", "GiftwrapChargeback", detail), "GIFT_WRAP_CHARGEBACKS")
    for name, semantic in {
        "FBAInventoryReimbursement": "INVENTORY_REIMBURSEMENTS",
        "FBAReversedReimbursement": "INVENTORY_REIMBURSEMENT_REVERSALS",
    }.items():
        add("FBAInventoryReimbursement", (name,), semantic)
    for kind in ("RemovalShipment", "Adjustment"):
        add(kind, ("RecommerceLiquidation",), "LIQUIDATION_PROCEEDS")
        add(kind, ("AmazonFees",), "LIQUIDATION_FEES")
        add(kind, ("Tax", "TaxOnRevenue"), "PRODUCT_TAX")
    add("RemovalShipment", ("Tax", "MarketplaceFacilitatorTax-Principal"), "TAX_WITHHELD")
    for kind, semantic in (
        ("ServiceFee - Correction", "FULFILLMENT_FEE_CORRECTIONS"),
        ("ServiceFee - Reversal", "FULFILLMENT_FEE_REVERSALS"),
    ):
        for detail in ("Base", "Tax"):
            add(kind, ("AmazonFees", "FBAPerUnitFulfillmentFee", detail), semantic)
    for detail in ("Base", "Tax"):
        add("ProductAdsPayment", (detail,), "ADVERTISING")
    fees = {
        "FBAStorageFee": "STORAGE_FEES",
        "FBALongTermStorageFee": "AGED_STORAGE_FEES",
        "FBADisposalFee": "DISPOSAL_FEES",
        "FBARemovalFee": "REMOVAL_FEES",
        "FBAInboundConvenienceFee": "INBOUND_PLACEMENT_FEES",
        "FBAInboundTransportationFee": "INBOUND_TRANSPORTATION_FEES",
        "FBAInboundTransportationProgramFee": "INBOUND_TRANSPORTATION_PROGRAM_FEES",
        "LabelingFee": "LABELING_FEES",
        "Subscription": "SUBSCRIPTION_FEES",
        "EPRChargebackEcoFee": "EPR_FEES",
        "EPRChargebackServiceFee": "EPR_FEES",
        "FBAInboundDefectFee": "INBOUND_DEFECT_FEES",
        "CouponParticipationFee": "COUPON_FEES",
        "CouponPerformanceFee": "COUPON_FEES",
        "DealParticipationFee": "DEAL_FEES",
        "DealPerformanceFee": "DEAL_FEES",
    }
    wrappers = {
        "FBAStorageFee": "StorageBillingFee",
        "FBALongTermStorageFee": "LongTermStorageFee",
        "FBAInboundConvenienceFee": "InboundConvenienceCharge",
        "FBAInboundTransportationFee": "InboundTransportationFee",
        "FBAInboundTransportationProgramFee": "InboundTransportationFee",
        "FBAInboundDefectFee": "UnplannedServiceCharge",
    }
    for fee, semantic in fees.items():
        for detail in ("Base", "Tax"):
            for root in ("AmazonFees", "FBAFees"):
                add("ServiceFee", (root, fee, detail), semantic)
            if fee in wrappers:
                add("ServiceFee", ("FBAFees", wrappers[fee], fee, detail), semantic)
            if fee.startswith(("Coupon", "Deal")):
                add("ServiceFee", ("AmazonFees", fee + "Rollup", fee, detail), semantic)
    add("ServiceFee", ("AmazonFees", "FBADisposalFee", "Promo"), "DISPOSAL_FEES")
    add("ServiceFee", ("AmazonFees", "VineEnrollmentFee", "VineFee", "Base"), "VINE_FEES")
    for leaf in ("Sales", "Expenses"):
        add("Adjustment", (leaf,), "CROSS_ACCOUNT_ADJUSTMENTS")
        add("Adjustment", (leaf, "CrossAccountDebtAdjustment"), "CROSS_ACCOUNT_ADJUSTMENTS")
    for leaf in ("ReserveDebit", "ReserveCredit"):
        add("Adjustment", (leaf,), "RESERVE_MOVEMENTS")
    add("Adjustment", ("FailedDisbursement",), "OTHER_ADJUSTMENTS")
    add("Adjustment", ("Tax",), "TAX_RECLASSIFICATION")
    add("DebtRecovery", ("DebtPayment",), "DEBT_RECOVERY")
    add("MiscellaneousLedgerAdjustment", ("Other",), "OTHER_ADJUSTMENTS")
    add("ServiceCharge", ("Other", "SupplyChainCreditRollUp", "MCCFCredit", "Base"), "MCF_CREDITS")
    for path in (("Expenses",), ("Sales", "FundTransfer")):
        add("Transfer", path, "BANK_TRANSFERS")
    for path in (
        ("Expenses", "RetrochargeReversal"),
        ("Sales", "Other"),
        ("Retrocharge", "BaseTax"),
        ("Retrocharge", "ShippingTax"),
        ("Tax", "MarketplaceFacilitatorTax-Principal"),
        ("Tax", "MarketplaceFacilitatorTax-Shipping"),
        ("Tax", "MarketplaceFacilitatorVAT-Principal"),
    ):
        add("Retrocharge", path, "TAX_RECLASSIFICATION")
    return result


FINANCES_TYPE_BY_SOURCE = MappingProxyType(_mapping())


def classify_finances_component(transaction_type: str, path: tuple[str, ...]) -> FinancesType:
    try:
        return FINANCES_TYPE_BY_SOURCE[transaction_type, path]
    except KeyError:
        raise ValueError(
            f"Unsupported Finances monetary path: {transaction_type}/{'/'.join(path)}"
        ) from None


def classify_zero_component(transaction_type: str, description: object) -> FinancesType:
    """Retain evidenced zero items without fabricating missing nonzero detail."""
    if transaction_type in {"Shipment", "Refund"}:
        return _BY_NAME["ZERO_ACTIVITY"]
    if transaction_type == "ServiceFee":
        if description == "FBAStorageBilling":
            return _BY_NAME["STORAGE_FEES"]
        if description == "FBADisposal":
            return _BY_NAME["DISPOSAL_FEES"]
        if description == "FBALongTermStorageBilling":
            return _BY_NAME["AGED_STORAGE_FEES"]
    raise ValueError("Unknown Finances zero-amount item without monetary breakdowns.")
