"""Versioned Settlement classification policy owned by the processor."""

from .models import AuxiliarySourceSystem, CategoryMappingRule, PnlTreatment


def _rule(
    priority: int,
    transaction_type: str | None,
    amount_type: str | None,
    amount_description: str | None,
    category_code: str,
    pnl_treatment: PnlTreatment = "SKU_PNL",
    auxiliary_source: AuxiliarySourceSystem | None = None,
) -> CategoryMappingRule:
    return CategoryMappingRule(
        priority=priority,
        transaction_type=transaction_type,
        amount_type=amount_type,
        amount_description=amount_description,
        category_code=category_code,
        pnl_treatment=pnl_treatment,
        preferred_auxiliary_source=auxiliary_source,
    )


# Changing this tuple requires a new PROCESSOR_VERSION. Raw Settlement rows remain
# untouched, and an operator can process the same report again with the new policy.
SETTLEMENT_CATEGORY_RULES: tuple[CategoryMappingRule, ...] = (
    _rule(10, "Order", "ItemPrice", "Principal", "PRODUCT_SALES"),
    _rule(20, "Refund", "ItemPrice", "Principal", "PRODUCT_REFUNDS"),
    _rule(30, "Order", "ItemPrice", "Shipping", "SHIPPING_CREDITS"),
    _rule(40, "Refund", "ItemPrice", "Shipping", "SHIPPING_REFUNDS"),
    _rule(50, "Order", "ItemPrice", "Giftwrap", "GIFT_WRAP_CREDITS"),
    _rule(60, "Refund", "ItemPrice", "Giftwrap", "GIFT_WRAP_REFUNDS"),
    _rule(70, None, "Promotion", None, "PROMOTIONAL_REBATES"),
    _rule(80, None, "ItemWithheldTax", None, "MARKETPLACE_WITHHELD_TAX"),
    _rule(
        90,
        "ServiceFee",
        "Cost of Advertising",
        None,
        "ADVERTISING_COST",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(110, None, None, "Storage Fee", "FBA_STORAGE_FEES", auxiliary_source="DATA_KIOSK"),
    _rule(
        120, None, None, "StorageRenewalBilling", "FBA_STORAGE_FEES", auxiliary_source="DATA_KIOSK"
    ),
    _rule(
        130,
        None,
        None,
        "FBA Inbound Placement Service Fee",
        "FBA_INBOUND_PLACEMENT_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(
        140,
        None,
        None,
        "Inbound Transportation Fee",
        "INBOUND_TRANSPORTATION_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(150, None, None, "DisposalComplete", "DISPOSAL_FEES", auxiliary_source="FBA_REPORT"),
    _rule(151, None, None, "RemovalComplete", "REMOVAL_FEES", auxiliary_source="FBA_REPORT"),
    _rule(
        152,
        "FBAFees",
        "FBA Removal Order: Return Fee",
        None,
        "REMOVAL_FEES",
        auxiliary_source="FBA_REPORT",
    ),
    _rule(160, None, None, "Subscription Fee", "SUBSCRIPTION_FEES", "ACCOUNT_EXPENSE"),
    _rule(170, None, None, "Payable to Amazon", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(180, None, None, "Successful charge", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(181, "Transfer", None, None, "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(182, None, None, "Current Reserve Amount", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(183, None, None, "Previous Reserve Amount Balance", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(184, None, None, "Beginning Balance", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(185, None, None, "Failed disbursement", "PAYMENT_MOVEMENT", "EXCLUDED"),
    _rule(190, None, "ItemPrice", "Tax", "SALES_TAX"),
    _rule(200, None, "ItemPrice", "ShippingTax", "SALES_TAX"),
    _rule(210, None, "ItemFees", "Commission", "REFERRAL_FEES"),
    _rule(220, None, "ItemFees", "FBAPerUnitFulfillmentFee", "FBA_FULFILLMENT_FEES"),
    _rule(230, "Refund", "ItemFees", "RefundCommission", "REFUND_ADMINISTRATION_FEES"),
    _rule(240, None, "ItemFees", "ShippingChargeback", "SHIPPING_CHARGEBACKS"),
    _rule(241, None, "ItemFees", "DigitalServicesFee", "DIGITAL_SERVICES_FEES"),
    _rule(242, None, "ItemFees", "Digital Services Fee", "DIGITAL_SERVICES_FEES"),
    _rule(243, "Liquidations", "ItemPrice", "Principal", "LIQUIDATIONS_PROCEEDS"),
    _rule(244, "Liquidations", "ItemPrice", "Tax", "SALES_TAX"),
    _rule(
        245, "Liquidations", "ItemFees", "LiquidationsBrokerageFee", "LIQUIDATIONS_BROKERAGE_FEES"
    ),
    _rule(
        250,
        "FBAFees",
        "FBA Inventory Storage Fee",
        None,
        "FBA_STORAGE_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(
        260,
        "FBAFees",
        "FBA Long-Term Storage Fee",
        None,
        "FBA_AGED_INVENTORY_FEES",
        auxiliary_source="FBA_REPORT",
    ),
    _rule(
        270,
        "FBAFees",
        "FBA Removal Order: Disposal Fee",
        None,
        "DISPOSAL_FEES",
        auxiliary_source="FBA_REPORT",
    ),
    _rule(
        300,
        "FBAFees",
        "FBA Long Term Storage Fee",
        None,
        "FBA_AGED_INVENTORY_FEES",
        auxiliary_source="FBA_REPORT",
    ),
    _rule(
        310,
        "FBAFees",
        "FBA Amazon-Partnered Carrier Shipment Fee",
        None,
        "INBOUND_TRANSPORTATION_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(
        320,
        "FBAFees",
        "Inbound Transportation Program Fee",
        None,
        "INBOUND_TRANSPORTATION_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(
        330,
        "other-transaction",
        "other-transaction",
        "FBAInboundTransportationFee",
        "INBOUND_TRANSPORTATION_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
    _rule(
        340,
        "other-transaction",
        "other-transaction",
        "FBAInboundTransportationProgramFee",
        "INBOUND_TRANSPORTATION_FEES",
        auxiliary_source="DATA_KIOSK",
    ),
)

__all__ = ["SETTLEMENT_CATEGORY_RULES"]
