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
    ["PRODUCT_SALES", "PRODUCT_REFUNDS", "NET_PRODUCT_SALES", "RESTOCKING"],
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
    [
      "FBA_FULFILMENT_FEE",
      "FBA_FULFILLMENT_FEE",
      "FBA_FULFILLMENT_FEES",
      "FULFILLMENT_FEE_CORRECTIONS",
      "FULFILLMENT_FEE_REVERSALS",
    ],
  ],
  referral: [
    "Referral fee",
    ["REFERRAL_FEE", "REFERRAL_FEES", "REFUNDED_REFERRAL_FEE", "REFUNDED_REFERRAL_FEES"],
  ],
  "inbound-placement": [
    "FBA inbound placement service fee",
    ["FBA_INBOUND_PLACEMENT_SERVICE_FEE", "INBOUND_PLACEMENT_FEES"],
  ],
  "inbound-transportation": [
    "Inbound transportation charge",
    [
      "FBA_INBOUND_CONVENIENCE_FEE",
      "FBA_INBOUND_TRANSPORTATION_FEE",
      "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
      "INBOUND_TRANSPORTATION_FEES",
      "INBOUND_TRANSPORTATION_PROGRAM_FEES",
    ],
  ],
  disposal: ["FBA disposal order fee", ["DISPOSAL_FEE", "DISPOSAL_FEES"]],
  "refund-administration": [
    "Refund administration fee",
    ["REFUND_COMMISSION_FEE", "REFUND_COMMISSION"],
  ],
  "monthly-storage": [
    "Monthly inventory storage fee",
    ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE", "STORAGE_FEES"],
  ],
  "sponsored-brands": [
    "Sponsored Brands charge",
    ["SPONSORED_BRANDS", "SPONSORED_BRANDS_CHARGE", "SPONSORED_BRANDS_CHARGES"],
  ],
  "sponsored-display": [
    "Sponsored Display charge",
    ["SPONSORED_DISPLAY", "SPONSORED_DISPLAY_CHARGE", "SPONSORED_DISPLAY_CHARGES"],
  ],
  advertising: ["Advertising", ["ADVERTISING"]],
  "digital-services": [
    "Digital services fees",
    ["DIGITAL_SERVICES_FEE_FBA", "DIGITAL_SERVICES_FEE_SOA", "DIGITAL_SERVICES_FEES"],
  ],
  removal: ["FBA removal order fee", ["REMOVAL_FEE", "REMOVAL_FEES"]],
  "long-term-storage": [
    "Long-term inventory storage fee",
    ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE", "AGED_STORAGE_FEES"],
  ],
  labeling: ["FBA labeling fee", ["LABELING_FEE", "LABELING_FEES"]],
  "shipping-gift-wrap": [
    "Shipping and gift wrap",
    [
      "SHIPPING_CREDITS",
      "SHIPPING_REFUNDS",
      "SHIPPING_CHARGEBACKS",
      "GIFT_WRAP_CREDITS",
      "GIFT_WRAP_CHARGEBACKS",
    ],
  ],
  promotions: [
    "Promotions",
    [
      "COUPON_PARTICIPATION_FEE",
      "COUPON_PERFORMANCE_FEE",
      "DEAL_PARTICIPATION_FEE",
      "DEAL_PERFORMANCE_FEE",
      "COUPON_FEES",
      "DEAL_FEES",
      "PROMOTIONAL_REBATES",
      "PROMOTIONAL_REFUNDS",
      "POINTS",
    ],
  ],
  taxes: [
    "Taxes",
    ["PRODUCT_TAX", "SHIPPING_TAX", "GIFT_WRAP_TAX", "TAX_WITHHELD", "TAX_RECLASSIFICATION"],
  ],
  reimbursements: [
    "Reimbursements",
    [
      "FBA_INVENTORY_REIMBURSEMENT",
      "INVENTORY_REIMBURSEMENTS",
      "INVENTORY_REIMBURSEMENT_REVERSALS",
    ],
  ],
  liquidations: [
    "Liquidations",
    [
      "LIQUIDATION_PROCESSING_FEE",
      "LIQUIDATION_REFERRAL_FEE",
      "LIQUIDATION_PROCEEDS",
      "LIQUIDATION_FEES",
    ],
  ],
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
  reconciliation: ["Finances / Data Kiosk difference", ["FINANCES_KIOSK_DIFFERENCE"]],
  other: ["Other", []],
} as const;

type GroupId = keyof typeof GROUPS;

const DIRECT_TYPES = new Map<string, GroupId>(
  Object.entries(GROUPS).flatMap(([id, [, types]]) =>
    types.map((type) => [type, id as GroupId] as const),
  ),
);

export function transactionTypeBreakdownGroupId(type: string): GroupId {
  return DIRECT_TYPES.get(type) ?? "other";
}

function salesOrder(type: string): number {
  if (type === "PRODUCT_SALES") return 0;
  if (type === "PRODUCT_REFUNDS") return 1;
  return type === "NET_PRODUCT_SALES" ? 2 : 3;
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
