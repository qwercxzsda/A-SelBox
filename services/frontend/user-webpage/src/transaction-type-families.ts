/** Ordered browsing groups shared by Type filters, row labels and amount breakdowns. */
export const TRANSACTION_TYPE_GROUPS = [
  { id: "sales", label: "Sales & refunds" },
  { id: "selling", label: "Selling fees" },
  { id: "fulfillment", label: "Fulfillment & shipping" },
  { id: "inventory", label: "Storage & inventory" },
  { id: "advertising", label: "Advertising & promotions" },
  { id: "taxes", label: "Taxes" },
  { id: "other", label: "Other fees & adjustments" },
  { id: "seller-costs", label: "Seller-provided costs" },
] as const;

export type TypeGroupDefinition = (typeof TRANSACTION_TYPE_GROUPS)[number];
export type TypeGroupId = TypeGroupDefinition["id"];

export type TypeFamilySource = "FINANCES" | "DATA_KIOSK";
export type TypeFamilyComparisonKind = "paired" | "different-basis" | "unpaired";

export interface TypeFamily {
  readonly id: string;
  readonly groupId: TypeGroupId;
  readonly label: string;
  readonly description: string;
  readonly comparisonKind: TypeFamilyComparisonKind;
  readonly comparisonNote: string;
  readonly financesTypes: readonly string[];
  readonly dataKioskTypes: readonly string[];
}

function family(
  id: string,
  groupId: TypeGroupId,
  label: string,
  description: string,
  financesTypes: readonly string[],
  dataKioskTypes: readonly string[],
  comparison?: { kind: "different-basis"; note: string },
): TypeFamily {
  return {
    id,
    groupId,
    label,
    description,
    financesTypes,
    dataKioskTypes,
    comparisonKind:
      comparison?.kind ?? (financesTypes.length && dataKioskTypes.length ? "paired" : "unpaired"),
    comparisonNote: comparison?.note ?? description,
  };
}

function unpairedFamily(
  id: string,
  groupId: TypeGroupId,
  label: string,
  source: TypeFamilySource,
  types: readonly string[],
  description: string,
): TypeFamily {
  return family(
    id,
    groupId,
    label,
    description,
    source === "FINANCES" ? types : [],
    source === "DATA_KIOSK" ? types : [],
  );
}

// One global hierarchy: exact source types belong to a detailed review family and
// inherit its broad browsing group. Marketplace, currency and dates never change membership.
// Memberships do not alter allocation, dates or coverage.
export const TRANSACTION_TYPE_FAMILIES: readonly TypeFamily[] = [
  family(
    "monthly-storage",
    "inventory",
    "Monthly storage fees",
    "Monthly inventory storage fees, separate from aged inventory surcharges. Finances billing can follow the service month allocated by Data Kiosk, so a same-month gap can reflect timing.",
    ["STORAGE_FEES"],
    ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
  ),
  family(
    "aged-storage",
    "inventory",
    "Aged inventory surcharges",
    "Long-term storage fees and aged inventory surcharges, separate from monthly storage.",
    ["AGED_STORAGE_FEES"],
    ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE"],
  ),
  family(
    "sponsored-products",
    "advertising",
    "Sponsored products",
    "Finances ProductAdsPayment charges and Data Kiosk Sponsored Products allocations. Posting and product/day allocation dates may differ; this mapping does not match individual invoices or campaigns. Sponsored Brands and Display are separate.",
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
    "advertising",
    "Sponsored brands",
    "Data Kiosk Sponsored Brands advertising aliases. No verified Finances counterpart is currently mapped to this family.",
    [],
    ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  ),
  family(
    "sponsored-display",
    "advertising",
    "Sponsored display",
    "Data Kiosk Sponsored Display advertising aliases. No verified Finances counterpart is currently mapped to this family.",
    [],
    ["SPONSORED_DISPLAY", "SPONSORED_DISPLAY_CHARGE", "SPONSORED_DISPLAY_CHARGES"],
  ),
  family(
    "coupons",
    "advertising",
    "Coupon fees",
    "Coupon participation and performance fees.",
    ["COUPON_FEES"],
    ["COUPON_PARTICIPATION_FEE", "COUPON_PERFORMANCE_FEE"],
  ),
  family(
    "deals",
    "advertising",
    "Deal fees",
    "Lightning deal, participation and performance fees.",
    ["DEAL_FEES"],
    ["DEAL_PARTICIPATION_FEE", "DEAL_PERFORMANCE_FEE", "RUN_LIGHTNING_DEAL_FEE"],
  ),
  family(
    "disposal",
    "inventory",
    "Disposal",
    "Inventory disposal fees.",
    ["DISPOSAL_FEES"],
    ["DISPOSAL_FEE"],
  ),
  family(
    "removal",
    "inventory",
    "Removal",
    "Inventory removal fees.",
    ["REMOVAL_FEES"],
    ["REMOVAL_FEE"],
  ),
  family(
    "labeling",
    "fulfillment",
    "Labeling",
    "Inventory labeling fees.",
    ["LABELING_FEES"],
    ["LABELING_FEE"],
  ),
  family(
    "inbound-transportation",
    "fulfillment",
    "Inbound transportation",
    "Inbound transportation and transportation-program charges together represent the shipment's transport cost. Both exact fee types remain available in records; billing dates and missing SKU allocations can still differ between sources.",
    ["INBOUND_TRANSPORTATION_FEES", "INBOUND_TRANSPORTATION_PROGRAM_FEES"],
    ["FBA_INBOUND_TRANSPORTATION_FEE", "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE"],
  ),
  family(
    "subscription",
    "other",
    "Seller subscription fees",
    "Seller subscription fees.",
    ["SUBSCRIPTION_FEES"],
    ["SUBSCRIPTION_FEE"],
  ),
  family(
    "fba-fulfillment",
    "fulfillment",
    "FBA fulfillment fees",
    "Net FBA fulfillment charges, including signed fee corrections and reversals. Data Kiosk fulfillment aliases represent the corresponding fee activity.",
    ["FBA_FULFILLMENT_FEES", "FULFILLMENT_FEE_CORRECTIONS", "FULFILLMENT_FEE_REVERSALS"],
    ["FBA_FULFILLMENT_FEE", "FBA_FULFILLMENT_FEES", "FBA_FULFILMENT_FEE"],
  ),
  family(
    "referral",
    "selling",
    "Referral and refund fees",
    "Net selling commission: original referral charges plus signed referral refunds and the administration fees Amazon retains on refunds. Exact charge, refund and administration types remain available in records.",
    ["REFERRAL_FEES", "REFUNDED_REFERRAL_FEES", "REFUND_COMMISSION"],
    ["REFERRAL_FEE", "REFERRAL_FEES", "REFUNDED_REFERRAL_FEE", "REFUND_COMMISSION_FEE"],
  ),
  family(
    "inventory-reimbursements",
    "inventory",
    "Inventory reimbursements",
    "Net inventory reimbursements after signed reimbursement reversals. Compare this balance with Data Kiosk inventory reimbursements.",
    ["INVENTORY_REIMBURSEMENTS", "INVENTORY_REIMBURSEMENT_REVERSALS"],
    ["FBA_INVENTORY_REIMBURSEMENT"],
  ),
  family(
    "digital-services",
    "selling",
    "Digital services fees",
    "Digital services fees across FBA and selling services.",
    ["DIGITAL_SERVICES_FEES"],
    ["DIGITAL_SERVICES_FEE_FBA", "DIGITAL_SERVICES_FEE_SOA"],
  ),
  family(
    "net-product-sales",
    "sales",
    "Product sales and refunds",
    "Finances product principal sales plus signed product refunds alongside Data Kiosk net product sales. Shipping, promotions, points, taxes and zero-value records without monetary detail remain separate.",
    ["PRODUCT_SALES", "PRODUCT_REFUNDS"],
    ["NET_PRODUCT_SALES"],
    {
      kind: "different-basis",
      note: "Finances uses posting dates; Data Kiosk uses ordered sales less refunds counted by refund-request time. Some Data Kiosk sales include shipping refunds or buyer discounts, but no universal adjustment covers these source types. This source gap is not a like-for-like difference.",
    },
  ),
  unpairedFamily(
    "zero-value-activity",
    "other",
    "Zero-value activity",
    "FINANCES",
    ["ZERO_ACTIVITY"],
    "Zero-value shipment and refund records without a monetary breakdown. Their purpose cannot be identified as product principal or a fee. No separate Data Kiosk type is mapped; its normalized stream drops zero components.",
  ),
  unpairedFamily(
    "shipping",
    "fulfillment",
    "Shipping",
    "FINANCES",
    ["SHIPPING_CREDITS", "SHIPPING_REFUNDS", "SHIPPING_CHARGEBACKS"],
    "Net shipping credits, refunds and chargebacks, excluding shipping tax. Some shipping refunds are embedded in Data Kiosk sales, but no universal counterpart is verified for these types. They remain separate in every marketplace.",
  ),
  unpairedFamily(
    "gift-wrapping",
    "fulfillment",
    "Gift wrapping",
    "FINANCES",
    ["GIFT_WRAP_CREDITS", "GIFT_WRAP_CHARGEBACKS"],
    "Net gift-wrap credits and chargebacks, excluding gift-wrap tax. No separate Data Kiosk gift-wrap counterpart is mapped; any inclusion within broader sales amounts requires source evidence.",
  ),
  unpairedFamily(
    "taxes",
    "taxes",
    "Taxes collected and withheld",
    "FINANCES",
    ["PRODUCT_TAX", "SHIPPING_TAX", "GIFT_WRAP_TAX", "TAX_WITHHELD"],
    "Net taxes on products, shipping, gift wrapping and liquidation revenue after marketplace withholding. Collected and withheld amounts retain their signs. No universal Data Kiosk counterpart is mapped; tax on Amazon fees stays with the corresponding fee.",
  ),
  unpairedFamily(
    "promotions",
    "advertising",
    "Promotions and points",
    "FINANCES",
    ["PROMOTIONAL_REBATES", "PROMOTIONAL_REFUNDS", "POINTS"],
    "Buyer product and shipping discounts, promotion reversals, and points charges or refund adjustments. Some product discounts are embedded in Data Kiosk sales, but these combined types have no verified universal counterpart. Fee discounts stay with their fee.",
  ),
  unpairedFamily(
    "restocking",
    "sales",
    "Restocking fees retained",
    "FINANCES",
    ["RESTOCKING"],
    "Restocking amounts retained from refunds. No separate Data Kiosk restocking type is mapped; potential inclusion within reported refund amounts is not yet verified.",
  ),
  unpairedFamily(
    "liquidation-proceeds",
    "inventory",
    "Liquidation proceeds",
    "FINANCES",
    ["LIQUIDATION_PROCEEDS"],
    "Gross recovery proceeds from liquidated inventory. Liquidation fees are separate; no verified Data Kiosk proceeds counterpart is currently mapped.",
  ),
  family(
    "liquidation-fees",
    "inventory",
    "Liquidation fees",
    "Finances liquidation AmazonFees compared with the sum of Data Kiosk liquidation processing and referral fees. Recovery proceeds remain separate.",
    ["LIQUIDATION_FEES"],
    ["LIQUIDATION_PROCESSING_FEE", "LIQUIDATION_REFERRAL_FEE"],
  ),
  unpairedFamily(
    "inbound-placement",
    "fulfillment",
    "Inbound placement service fees",
    "DATA_KIOSK",
    ["FBA_INBOUND_PLACEMENT_SERVICE_FEE"],
    "Data Kiosk inbound placement service fees identified by their exact source key. No verified Finances counterpart is currently mapped; similarly named inbound convenience charges remain separate unless source evidence establishes an equivalent scope.",
  ),
  family(
    "inbound-convenience",
    "fulfillment",
    "Inbound convenience fees",
    "Finances native FBAInboundConvenienceFee paired with Data Kiosk FBA_INBOUND_CONVENIENCE_FEE by exact source identity. The separately named inbound placement service fee remains a distinct family; similarity of labels alone does not establish equivalence.",
    ["INBOUND_PLACEMENT_FEES"],
    ["FBA_INBOUND_CONVENIENCE_FEE"],
  ),
  unpairedFamily(
    "epr-compliance",
    "other",
    "EPR compliance fees",
    "FINANCES",
    ["EPR_FEES"],
    "Extended Producer Responsibility eco and service charges from native EPRChargebackEcoFee and EPRChargebackServiceFee. Separate from Vine enrollment and inbound defects; no verified Data Kiosk counterpart is currently mapped.",
  ),
  unpairedFamily(
    "vine-enrollment",
    "other",
    "Vine enrollment fees",
    "FINANCES",
    ["VINE_FEES"],
    "Amazon Vine enrollment charges from native VineEnrollmentFee/VineFee. No verified Data Kiosk counterpart is currently mapped.",
  ),
  unpairedFamily(
    "inbound-defects",
    "other",
    "Inbound defect fees",
    "FINANCES",
    ["INBOUND_DEFECT_FEES"],
    "FBA inbound defect charges from native FBAInboundDefectFee, including its UnplannedServiceCharge wrapper. Separate from transportation, convenience and placement fees; no verified Data Kiosk counterpart is currently mapped.",
  ),
  unpairedFamily(
    "supply-chain-credits",
    "other",
    "Supply-chain credits",
    "FINANCES",
    ["MCF_CREDITS"],
    "Credits from native SupplyChainCreditRollUp/MCCFCredit. Kept separate from failed disbursements and miscellaneous account adjustments; no verified Data Kiosk counterpart is currently mapped.",
  ),
  unpairedFamily(
    "account-adjustments",
    "other",
    "Other account adjustments",
    "FINANCES",
    ["OTHER_ADJUSTMENTS"],
    "Reviewed failed-disbursement and miscellaneous ledger adjustments. This mixed native adjustment type is kept separate from identified supply-chain credits and service charges; no verified Data Kiosk counterpart is currently mapped.",
  ),
  unpairedFamily(
    "balance-movements",
    "other",
    "Balance movements",
    "FINANCES",
    ["DEBT_RECOVERY", "CROSS_ACCOUNT_ADJUSTMENTS", "RESERVE_MOVEMENTS", "BANK_TRANSFERS"],
    "Debt recovery, cross-account adjustments and reserve debits/credits. These move account balances rather than measure service costs. Bank-transfer types remain excluded wherever activity rules exclude them; no verified Data Kiosk balance-movement counterpart is mapped.",
  ),
  unpairedFamily(
    "tax-reclassification",
    "taxes",
    "Tax reclassification",
    "FINANCES",
    ["TAX_RECLASSIFICATION"],
    "Account tax corrections and retrocharges, kept separate from transaction taxes and service fees. No verified Data Kiosk tax-reclassification counterpart is currently mapped.",
  ),
  unpairedFamily(
    "cost-of-goods-sold",
    "seller-costs",
    "Cost of goods sold per unit",
    "DATA_KIOSK",
    ["COST_OF_GOODS_SOLD"],
    "Seller-provided product cost per unit. No Finances type is mapped to this input. This analysis-only input is not a posted charge and is excluded from Financial review and payout amounts.",
  ),
  unpairedFamily(
    "mfn-fulfillment-cost",
    "seller-costs",
    "Merchant fulfillment cost per unit",
    "DATA_KIOSK",
    ["MFN_FULFILLMENT_COST"],
    "Seller-provided merchant fulfillment cost per unit, including labor, packing, shipping and customer service. No Finances type is mapped to this input. This analysis-only input is not a posted charge and is excluded from Financial review and payout amounts.",
  ),
  unpairedFamily(
    "mfn-storage-cost",
    "seller-costs",
    "Merchant storage cost per unit/month",
    "DATA_KIOSK",
    ["MFN_STORAGE_COST"],
    "Seller-provided merchant storage cost per unit per month. No Finances type is mapped to this input. This analysis-only input is not a posted charge and is excluded from Financial review and payout amounts.",
  ),
  unpairedFamily(
    "miscellaneous-cost",
    "seller-costs",
    "Other seller costs per unit",
    "DATA_KIOSK",
    ["MISCELLANEOUS_COST"],
    "Seller-provided other costs per unit. No Finances type is mapped to this input. This analysis-only input is not a posted charge and is excluded from Financial review and payout amounts.",
  ),
  unpairedFamily(
    "shipping-to-amazon-cost",
    "seller-costs",
    "Shipping to Amazon cost per unit",
    "DATA_KIOSK",
    ["SHIPPING_TO_AMAZON_COST"],
    "Seller-provided shipping-to-Amazon cost per unit. No Finances type is mapped to this input. This analysis-only input is not a posted charge and is excluded from Financial review and payout amounts.",
  ),
];
