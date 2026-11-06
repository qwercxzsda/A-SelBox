export type FeeFamilySource = "FINANCES" | "DATA_KIOSK";

export interface FeeFamily {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly financesTypes: readonly string[];
  readonly dataKioskTypes: readonly string[];
}

function family(
  id: string,
  label: string,
  description: string,
  financesTypes: readonly string[],
  dataKioskTypes: readonly string[],
): FeeFamily {
  return { id, label, description, financesTypes, dataKioskTypes };
}

function sourceFamily(
  id: string,
  label: string,
  source: FeeFamilySource,
  types: readonly string[],
  description: string,
): FeeFamily {
  return family(
    id,
    label,
    description,
    source === "FINANCES" ? types : [],
    source === "DATA_KIOSK" ? types : [],
  );
}

// Exact source identities from the transaction taxonomy. These review groupings
// do not change accounting allocation or imply equal billing dates or coverage.
export const FEE_FAMILIES: readonly FeeFamily[] = [
  family(
    "monthly-storage",
    "Monthly storage",
    "Monthly inventory storage fees, separate from aged inventory surcharges.",
    ["STORAGE_FEES"],
    ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
  ),
  family(
    "aged-storage",
    "Aged storage",
    "Long-term storage fees and aged inventory surcharges, separate from monthly storage.",
    ["AGED_STORAGE_FEES"],
    ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE"],
  ),
  family(
    "sponsored-products",
    "Sponsored products",
    "Finances ProductAdsPayment charges and Data Kiosk Sponsored Products aliases. Sponsored Brands and Display are separate.",
    ["ADVERTISING"],
    [
      "SPONSORED_PRODUCT_FEE",
      "SPONSORED_PRODUCTS",
      "SPONSORED_PRODUCTS_CHARGE",
      "SPONSORED_PRODUCTS_CHARGES",
    ],
  ),
  family(
    "sponsored-brands",
    "Sponsored brands",
    "Data Kiosk Sponsored Brands advertising aliases. No Finances type is assigned to this family.",
    [],
    ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  ),
  family(
    "sponsored-display",
    "Sponsored display",
    "Data Kiosk Sponsored Display advertising aliases. No Finances type is assigned to this family.",
    [],
    ["SPONSORED_DISPLAY", "SPONSORED_DISPLAY_CHARGE", "SPONSORED_DISPLAY_CHARGES"],
  ),
  family(
    "coupons",
    "Coupons",
    "Coupon participation and performance fees.",
    ["COUPON_FEES"],
    ["COUPON_PARTICIPATION_FEE", "COUPON_PERFORMANCE_FEE"],
  ),
  family(
    "deals",
    "Deals",
    "Lightning deal, participation and performance fees.",
    ["DEAL_FEES"],
    ["DEAL_PARTICIPATION_FEE", "DEAL_PERFORMANCE_FEE", "RUN_LIGHTNING_DEAL_FEE"],
  ),
  family("disposal", "Disposal", "Inventory disposal fees.", ["DISPOSAL_FEES"], ["DISPOSAL_FEE"]),
  family("removal", "Removal", "Inventory removal fees.", ["REMOVAL_FEES"], ["REMOVAL_FEE"]),
  family("labeling", "Labeling", "Inventory labeling fees.", ["LABELING_FEES"], ["LABELING_FEE"]),
  family(
    "inbound-transportation",
    "Inbound transportation",
    "Inbound transportation fees, separate from transportation program fees.",
    ["INBOUND_TRANSPORTATION_FEES"],
    ["FBA_INBOUND_TRANSPORTATION_FEE"],
  ),
  family(
    "inbound-transportation-program",
    "Inbound transportation program",
    "Inbound transportation program fees, separate from other inbound transportation.",
    ["INBOUND_TRANSPORTATION_PROGRAM_FEES"],
    ["FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE"],
  ),
  family(
    "subscription",
    "Subscription",
    "Seller subscription fees.",
    ["SUBSCRIPTION_FEES"],
    ["SUBSCRIPTION_FEE"],
  ),
  family(
    "fba-fulfillment",
    "FBA fulfillment",
    "Net FBA fulfillment charges, including signed fee corrections and reversals. Data Kiosk fulfillment aliases represent the corresponding fee activity.",
    ["FBA_FULFILLMENT_FEES", "FULFILLMENT_FEE_CORRECTIONS", "FULFILLMENT_FEE_REVERSALS"],
    ["FBA_FULFILLMENT_FEE", "FBA_FULFILLMENT_FEES", "FBA_FULFILMENT_FEE"],
  ),
  family(
    "referral",
    "Referral fees",
    "Net referral fees after returned referral fees. Original charges and refunds retain their signs; refund administration commission remains separate.",
    ["REFERRAL_FEES", "REFUNDED_REFERRAL_FEES"],
    ["REFERRAL_FEE", "REFERRAL_FEES", "REFUNDED_REFERRAL_FEE"],
  ),
  family(
    "refund-commission",
    "Refund commission",
    "Commission charged on refunds, separate from returned referral fees.",
    ["REFUND_COMMISSION"],
    ["REFUND_COMMISSION_FEE"],
  ),
  family(
    "inventory-reimbursements",
    "Inventory reimbursements",
    "Net inventory reimbursements after signed reimbursement reversals. Compare this balance with Data Kiosk inventory reimbursements.",
    ["INVENTORY_REIMBURSEMENTS", "INVENTORY_REIMBURSEMENT_REVERSALS"],
    ["FBA_INVENTORY_REIMBURSEMENT"],
  ),
  family(
    "digital-services",
    "Digital services fees",
    "Digital services fees across FBA and selling services.",
    ["DIGITAL_SERVICES_FEES"],
    ["DIGITAL_SERVICES_FEE_FBA", "DIGITAL_SERVICES_FEE_SOA"],
  ),
  family(
    "net-product-sales",
    "Net product sales",
    "Product sales plus signed product refunds, compared with Data Kiosk net product sales. Zero-value shipment/refund activity is retained. Shipping, promotions and taxes are separate; refund timing can differ between sources.",
    ["PRODUCT_SALES", "PRODUCT_REFUNDS", "ZERO_ACTIVITY"],
    ["NET_PRODUCT_SALES"],
  ),
  sourceFamily(
    "shipping",
    "Shipping",
    "FINANCES",
    ["SHIPPING_CREDITS", "SHIPPING_REFUNDS", "SHIPPING_CHARGEBACKS"],
    "Net shipping credits, refunds and chargebacks, excluding shipping tax. No separate Data Kiosk shipping counterpart is defined; this is unmatched source activity.",
  ),
  sourceFamily(
    "gift-wrapping",
    "Gift wrapping",
    "FINANCES",
    ["GIFT_WRAP_CREDITS", "GIFT_WRAP_CHARGEBACKS"],
    "Net gift-wrap credits and chargebacks, excluding gift-wrap tax. No separate Data Kiosk gift-wrap counterpart is defined.",
  ),
  sourceFamily(
    "taxes",
    "Taxes collected and withheld",
    "FINANCES",
    ["PRODUCT_TAX", "SHIPPING_TAX", "GIFT_WRAP_TAX", "TAX_WITHHELD"],
    "Net product, shipping and gift-wrap taxes after marketplace withholding. Collected and withheld amounts offset using their original signs; this is not a fee or a separate Data Kiosk tax comparison.",
  ),
  sourceFamily(
    "promotions",
    "Promotions and points",
    "FINANCES",
    ["PROMOTIONAL_REBATES", "PROMOTIONAL_REFUNDS", "POINTS"],
    "Net promotional rebates, returned promotions and granted/reclaimed points. Kept outside product principal and coupon participation fees; no separate Data Kiosk counterpart is defined.",
  ),
  sourceFamily(
    "restocking",
    "Restocking",
    "FINANCES",
    ["RESTOCKING"],
    "Restocking amounts retained from refunds. No separate Data Kiosk restocking counterpart is defined.",
  ),
  sourceFamily(
    "liquidation-proceeds",
    "Liquidation proceeds",
    "FINANCES",
    ["LIQUIDATION_PROCEEDS"],
    "Gross recovery proceeds from liquidated inventory. Liquidation fees are a separate family; Data Kiosk has no liquidation-proceeds type in this registry.",
  ),
  family(
    "liquidation-fees",
    "Liquidation fees",
    "Finances liquidation AmazonFees compared with the sum of Data Kiosk liquidation processing and referral fees. Recovery proceeds remain separate.",
    ["LIQUIDATION_FEES"],
    ["LIQUIDATION_PROCESSING_FEE", "LIQUIDATION_REFERRAL_FEE"],
  ),
  sourceFamily(
    "data-kiosk-inbound-placement",
    "Inbound placement · Data Kiosk",
    "DATA_KIOSK",
    ["FBA_INBOUND_PLACEMENT_SERVICE_FEE"],
    "Inbound placement service fees. Finances inbound convenience charges belong to a different family; no Finances placement-service counterpart is defined.",
  ),
  // Finances maps native FBAInboundConvenienceFee to INBOUND_PLACEMENT_FEES.
  family(
    "inbound-convenience",
    "Inbound convenience",
    "Finances INBOUND_PLACEMENT_FEES represents native FBAInboundConvenienceFee, paired with Data Kiosk inbound convenience fees. Placement service fees remain separate.",
    ["INBOUND_PLACEMENT_FEES"],
    ["FBA_INBOUND_CONVENIENCE_FEE"],
  ),
  sourceFamily(
    "seller-service-fees",
    "Seller service fees",
    "FINANCES",
    ["EPR_FEES", "VINE_FEES", "INBOUND_DEFECT_FEES"],
    "Seller account charges for compliance, Vine enrolment and inbound defects. These operating charges have no defined Data Kiosk counterpart. Subscription fees remain separately comparable.",
  ),
  sourceFamily(
    "account-adjustments",
    "Account credits and adjustments",
    "FINANCES",
    ["MCF_CREDITS", "OTHER_ADJUSTMENTS"],
    "MCF supply-chain credits and miscellaneous ledger adjustments, including failed-disbursement adjustments. These are mixed account activity, not all fees, and have no defined Data Kiosk counterpart.",
  ),
  sourceFamily(
    "balance-movements",
    "Balance movements",
    "FINANCES",
    ["DEBT_RECOVERY", "CROSS_ACCOUNT_ADJUSTMENTS", "RESERVE_MOVEMENTS", "BANK_TRANSFERS"],
    "Debt recovery, cross-account adjustments and reserve debits/credits. These move account balances rather than measure service costs. Bank-transfer types remain excluded wherever the activity rules exclude them; Data Kiosk has no balance-movement counterpart.",
  ),
  sourceFamily(
    "tax-reclassification",
    "Tax reclassification",
    "FINANCES",
    ["TAX_RECLASSIFICATION"],
    "Account tax corrections and retrocharges, kept separate from transaction taxes and service fees. No Data Kiosk tax-reclassification counterpart is defined.",
  ),
  sourceFamily(
    "cost-of-goods-sold",
    "Cost of goods sold",
    "DATA_KIOSK",
    ["COST_OF_GOODS_SOLD"],
    "Seller-provided product costs retained for analysis only; excluded from Financial review and payout amounts.",
  ),
  sourceFamily(
    "mfn-fulfillment-cost",
    "MFN fulfillment cost",
    "DATA_KIOSK",
    ["MFN_FULFILLMENT_COST"],
    "Seller-provided merchant-fulfilled delivery costs retained for analysis only; excluded from Financial review and payout amounts.",
  ),
  sourceFamily(
    "mfn-storage-cost",
    "MFN storage cost",
    "DATA_KIOSK",
    ["MFN_STORAGE_COST"],
    "Seller-provided merchant-fulfilled storage costs retained for analysis only; excluded from Financial review and payout amounts.",
  ),
  sourceFamily(
    "miscellaneous-cost",
    "Miscellaneous cost",
    "DATA_KIOSK",
    ["MISCELLANEOUS_COST"],
    "Seller-provided miscellaneous costs retained for analysis only; excluded from Financial review and payout amounts.",
  ),
  sourceFamily(
    "shipping-to-amazon-cost",
    "Shipping to Amazon cost",
    "DATA_KIOSK",
    ["SHIPPING_TO_AMAZON_COST"],
    "Seller-provided inbound shipping costs retained for analysis only; excluded from Financial review and payout amounts.",
  ),
];
