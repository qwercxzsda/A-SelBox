/** Ordered browsing groups shared by Type filters, row labels and amount breakdowns. */
export const TRANSACTION_TYPE_GROUPS = [
  { id: "sales", label: "Sales & refunds" },
  { id: "selling", label: "Selling fees" },
  { id: "fulfillment", label: "Fulfillment & shipping" },
  { id: "inventory", label: "Storage & inventory" },
  { id: "advertising", label: "Advertising & promotions" },
  { id: "taxes", label: "Taxes" },
  { id: "other", label: "Other fees & adjustments" },
] as const;

export type TypeGroupDefinition = (typeof TRANSACTION_TYPE_GROUPS)[number];
export type TypeGroupId = TypeGroupDefinition["id"];

export const TYPES_BY_GROUP: Record<TypeGroupId, readonly string[]> = {
  inventory: [
    "STORAGE_FEES",
    "AGED_STORAGE_FEES",
    "DISPOSAL_FEES",
    "REMOVAL_FEES",
    "INVENTORY_REIMBURSEMENTS",
    "INVENTORY_REIMBURSEMENT_REVERSALS",
    "LIQUIDATION_PROCEEDS",
    "LIQUIDATION_FEES",
  ],
  advertising: [
    "ADVERTISING",
    "COUPON_FEES",
    "DEAL_FEES",
    "PROMOTIONAL_REBATES",
    "PROMOTIONAL_REFUNDS",
    "POINTS",
  ],
  fulfillment: [
    "LABELING_FEES",
    "INBOUND_TRANSPORTATION_FEES",
    "INBOUND_TRANSPORTATION_PROGRAM_FEES",
    "FBA_FULFILLMENT_FEES",
    "FULFILLMENT_FEE_CORRECTIONS",
    "FULFILLMENT_FEE_REVERSALS",
    "SHIPPING_CREDITS",
    "SHIPPING_REFUNDS",
    "SHIPPING_CHARGEBACKS",
    "GIFT_WRAP_CREDITS",
    "GIFT_WRAP_CHARGEBACKS",
    "INBOUND_PLACEMENT_FEES",
    "RETURNS_PROCESSING_FEES",
  ],
  other: [
    "SUBSCRIPTION_FEES",
    "ZERO_ACTIVITY",
    "EPR_FEES",
    "VINE_FEES",
    "INBOUND_DEFECT_FEES",
    "MCF_CREDITS",
    "OTHER_ADJUSTMENTS",
    "DEBT_RECOVERY",
    "CROSS_ACCOUNT_ADJUSTMENTS",
    "RESERVE_MOVEMENTS",
    "BANK_TRANSFERS",
  ],
  selling: [
    "REFERRAL_FEES",
    "REFUNDED_REFERRAL_FEES",
    "REFUND_COMMISSION",
    "DIGITAL_SERVICES_FEES",
  ],
  sales: ["PRODUCT_SALES", "PRODUCT_REFUNDS", "RESTOCKING"],
  taxes: ["PRODUCT_TAX", "SHIPPING_TAX", "GIFT_WRAP_TAX", "TAX_WITHHELD", "TAX_RECLASSIFICATION"],
};
