import type { CurrencyTotal, TransactionTypeTotal } from "./api/types.ts";
import { sumExactDecimals } from "./decimal.ts";

export interface TransactionTypeGroup {
  id: string;
  label: string;
  totals: CurrencyTotal;
  types: TransactionTypeTotal[];
}

// Display order follows the reference report. These groups do not change source
// allocation or combine distinct raw types into synthetic financial components.
const GROUPS = {
  "sales-and-refunds": [
    "Sales and refunds",
    ["PRODUCT_SALES", "PRODUCT_REFUNDS", "NET_PRODUCT_SALES"],
  ],
  "sponsored-products": [
    "Sponsored Products charge",
    [
      "SPONSORED_PRODUCT_FEE",
      "SPONSORED_PRODUCTS",
      "SPONSORED_PRODUCTS_CHARGE",
      "SPONSORED_PRODUCTS_CHARGES",
    ],
  ],
  "fba-fulfillment": [
    "FBA fulfillment fees",
    ["FBA_FULFILMENT_FEE", "FBA_FULFILLMENT_FEE", "FBA_FULFILLMENT_FEES"],
  ],
  referral: ["Referral fee", ["REFERRAL_FEE", "REFERRAL_FEES", "REFUNDED_REFERRAL_FEE"]],
  "inbound-placement": ["FBA inbound placement service fee", ["FBA_INBOUND_PLACEMENT_SERVICE_FEE"]],
  "inbound-transportation": [
    "Inbound transportation charge",
    [
      "FBA_INBOUND_CONVENIENCE_FEE",
      "FBA_INBOUND_TRANSPORTATION_FEE",
      "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
    ],
  ],
  disposal: ["FBA disposal order fee", ["DISPOSAL_FEE"]],
  "refund-administration": ["Refund administration fee", ["REFUND_COMMISSION_FEE"]],
  "monthly-storage": [
    "Monthly inventory storage fee",
    ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
  ],
  "sponsored-brands": [
    "Sponsored Brands charge",
    ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  ],
  "sponsored-display": [
    "Sponsored Display charge",
    ["SPONSORED_DISPLAY", "SPONSORED_DISPLAY_CHARGE", "SPONSORED_DISPLAY_CHARGES"],
  ],
  advertising: ["Advertising", []],
  "digital-services": [
    "Digital services fees",
    ["DIGITAL_SERVICES_FEE_FBA", "DIGITAL_SERVICES_FEE_SOA"],
  ],
  removal: ["FBA removal order fee", ["REMOVAL_FEE"]],
  "long-term-storage": [
    "Long-term inventory storage fee",
    ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE"],
  ],
  labeling: ["FBA labeling fee", ["LABELING_FEE"]],
  "shipping-gift-wrap": ["Shipping and gift wrap", []],
  promotions: [
    "Promotions",
    [
      "COUPON_PARTICIPATION_FEE",
      "COUPON_PERFORMANCE_FEE",
      "DEAL_PARTICIPATION_FEE",
      "DEAL_PERFORMANCE_FEE",
    ],
  ],
  taxes: ["Taxes", []],
  reimbursements: ["Reimbursements", ["FBA_INVENTORY_REIMBURSEMENT"]],
  liquidations: ["Liquidations", ["LIQUIDATION_PROCESSING_FEE", "LIQUIDATION_REFERRAL_FEE"]],
  "off-amazon-costs": [
    "Off-Amazon costs",
    [
      "COST_OF_GOODS_SOLD",
      "SHIPPING_TO_AMAZON_COST",
      "MFN_FULFILLMENT_COST",
      "MFN_STORAGE_COST",
      "MISCELLANEOUS_COST",
    ],
  ],
  reconciliation: ["Settlement / Data Kiosk difference", ["SETTLEMENT_KIOSK_DIFFERENCE"]],
  other: ["Other", []],
} as const;

type GroupId = keyof typeof GROUPS;

const DIRECT_TYPES = new Map<string, GroupId>(
  Object.entries(GROUPS).flatMap(([id, [, types]]) =>
    types.map((type) => [type, id as GroupId] as const),
  ),
);

const ITEM_FEES: Readonly<Partial<Record<string, GroupId>>> = {
  COMMISSION: "referral",
  REFUND_COMMISSION: "refund-administration",
  FBA_PER_UNIT_FULFILLMENT_FEE: "fba-fulfillment",
  DIGITAL_SERVICES_FEE: "digital-services",
  LIQUIDATIONS_BROKERAGE_FEE: "liquidations",
  SHIPPING_CHARGEBACK: "shipping-gift-wrap",
  GIFTWRAP_CHARGEBACK: "shipping-gift-wrap",
  GIFT_WRAP_CHARGEBACK: "shipping-gift-wrap",
};

const NAMED_FEES: Readonly<Partial<Record<string, GroupId>>> = {
  "AMAZON_FEES/FBA_FULFILMENT_FEE_PER_UNIT_CORRECTION": "fba-fulfillment",
  "AMAZON_FEES/FBA_FULFILMENT_FEE_PER_UNIT_REVERSAL": "fba-fulfillment",
  "AMAZON_FEES/COUPON_PARTICIPATION_FEE": "promotions",
  "AMAZON_FEES/COUPON_PERFORMANCE_BASED_FEE": "promotions",
  "AMAZON_FEES/DEAL_PARTICIPATION_FEE": "promotions",
  "AMAZON_FEES/DEAL_PERFORMANCE_BASED_FEE": "promotions",
  "FBA_FEES/FBA_AMAZON_PARTNERED_CARRIER_SHIPMENT_FEE": "inbound-transportation",
  "FBA_FEES/FBA_INBOUND_PLACEMENT_SERVICE_FEE": "inbound-placement",
  "FBA_FEES/INBOUND_TRANSPORTATION_PROGRAM_FEE": "inbound-transportation",
  "FBA_FEES/FBA_INVENTORY_STORAGE_FEE": "monthly-storage",
  "FBA_FEES/FBA_LONG_TERM_STORAGE_FEE": "long-term-storage",
  "FBA_FEES/FBA_REMOVAL_ORDER_DISPOSAL_FEE": "disposal",
  "FBA_FEES/FBA_REMOVAL_ORDER_RETURN_FEE": "removal",
};

const OTHER_TRANSACTIONS: Readonly<Partial<Record<string, GroupId>>> = {
  DISPOSAL_COMPLETE: "disposal",
  FBA_INBOUND_PLACEMENT_SERVICE_FEE: "inbound-placement",
  FBA_INBOUND_TRANSPORTATION_FEE: "inbound-transportation",
  FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE: "inbound-transportation",
  INBOUND_TRANSPORTATION_FEE: "inbound-transportation",
  REMOVAL_COMPLETE: "removal",
  STORAGE_FEE: "monthly-storage",
  STORAGE_RENEWAL_BILLING: "long-term-storage",
};

const PRICE_COMPONENTS = new Set(["PRINCIPAL", "RESTOCKING_FEE"]);
const SHIPPING_COMPONENTS = new Set(["SHIPPING", "GIFT_WRAP", "GIFTWRAP"]);
const TAX_COMPONENTS = new Set(["TAX", "SHIPPING_TAX", "TAX_DISCOUNT"]);
const TAXABLE_FEE_GROUPS = new Set<GroupId>(["monthly-storage", "long-term-storage", "disposal"]);

function normalizePart(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

export function transactionTypeBreakdownGroupId(type: string): GroupId {
  const parts = type.split("/").map(normalizePart);
  if (parts.length === 1) return DIRECT_TYPES.get(parts[0]) ?? "other";
  if (parts.length !== 3) return "other";
  const [transaction, amountType, description] = parts;
  const ordinary = transaction === "ORDER" || transaction === "REFUND";
  const retrocharge = transaction === "ORDER_RETROCHARGE" || transaction === "REFUND_RETROCHARGE";
  if (ordinary || retrocharge) {
    if (amountType === "ITEM_WITHHELD_TAX") return "taxes";
    // Explicit tax components, including Promotion/TaxDiscount, stay together.
    if (["ITEM_PRICE", "PROMOTION"].includes(amountType) && TAX_COMPONENTS.has(description))
      return "taxes";
  }
  if (ordinary) {
    if (amountType === "ITEM_PRICE" && PRICE_COMPONENTS.has(description))
      return "sales-and-refunds";
    if (amountType === "ITEM_PRICE" && SHIPPING_COMPONENTS.has(description))
      return "shipping-gift-wrap";
    if (amountType === "PROMOTION") return "promotions";
    if (amountType === "ITEM_FEES") return ITEM_FEES[description] ?? "other";
  }
  if (
    (transaction === "LIQUIDATIONS" || transaction === "LIQUIDATIONS_ADJUSTMENTS") &&
    (amountType === "ITEM_PRICE" || amountType === "ITEM_FEES")
  )
    return "liquidations";
  if (transaction === "OTHER_TRANSACTION" && amountType === "FBA_INVENTORY_REIMBURSEMENT")
    return "reimbursements";
  if (transaction === "OTHER_TRANSACTION" && amountType === "OTHER_TRANSACTION")
    return OTHER_TRANSACTIONS[description] ?? "other";
  if (
    transaction === "SERVICE_FEE" &&
    amountType === "COST_OF_ADVERTISING" &&
    description === "TRANSACTION_TOTAL_AMOUNT"
  )
    return "advertising";
  const named = NAMED_FEES[`${transaction}/${amountType}`];
  if (named && description === "BASE_FEE") return named;
  // Keep a fee's base and tax together, just as Data Kiosk's fee total does.
  if (named && description === "TAX_ON_FEE" && TAXABLE_FEE_GROUPS.has(named)) return named;
  return "other";
}

function salesOrder(type: string): number {
  const normalized = type.split("/").map(normalizePart).join("/");
  if (normalized === "PRODUCT_SALES" || normalized === "ORDER/ITEM_PRICE/PRINCIPAL") return 0;
  if (normalized === "PRODUCT_REFUNDS" || normalized === "REFUND/ITEM_PRICE/PRINCIPAL") return 1;
  return normalized === "NET_PRODUCT_SALES" ? 2 : 3;
}

function compareTypes(left: TransactionTypeTotal, right: TransactionTypeTotal): number {
  const rank = salesOrder(left.type) - salesOrder(right.type);
  return rank || (left.type < right.type ? -1 : left.type > right.type ? 1 : 0);
}

function sumTypes(rows: readonly TransactionTypeTotal[], currency: string): CurrencyTotal {
  return {
    currency,
    reportedAmount: sumExactDecimals(rows.map((row) => row.reportedAmount)),
    serviceFee: sumExactDecimals(rows.map((row) => row.serviceFee)),
    companyAmount: sumExactDecimals(rows.map((row) => row.companyAmount)),
    rowCount: rows.reduce((count, row) => count + row.rowCount, 0),
    missingFeeCount: rows.reduce((count, row) => count + row.missingFeeCount, 0),
  };
}

export function totalTransactionTypes(
  rows: readonly TransactionTypeTotal[],
  currency: string,
): CurrencyTotal {
  return sumTypes(
    rows.filter((row) => row.currency === currency),
    currency,
  );
}

export function groupTransactionTypes(
  rows: readonly TransactionTypeTotal[],
  currency: string,
): TransactionTypeGroup[] {
  const grouped = new Map<GroupId, TransactionTypeTotal[]>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const id = transactionTypeBreakdownGroupId(row.type);
    const types = grouped.get(id) ?? [];
    types.push(row);
    grouped.set(id, types);
  }
  return Object.entries(GROUPS).flatMap(([id, [label]]) => {
    const types = grouped.get(id as GroupId);
    return types
      ? [{ id, label, totals: sumTypes(types, currency), types: types.sort(compareTypes) }]
      : [];
  });
}
