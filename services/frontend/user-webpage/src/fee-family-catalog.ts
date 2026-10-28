import type { CanonicalRow } from "./api/types.ts";
import { transactionTypeLabel } from "./categories.ts";

export type FeeFamilySource = "FINANCES" | "DATA_KIOSK";

export interface FeeFamily {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly financesTypes: readonly string[];
  readonly dataKioskTypes: readonly string[];
}

const SOURCE_LABELS = { FINANCES: "Finances", DATA_KIOSK: "Data Kiosk" };

function family(
  id: string,
  label: string,
  description: string,
  financesTypes: readonly string[],
  dataKioskTypes: readonly string[],
): FeeFamily {
  return { id, label, description, financesTypes, dataKioskTypes };
}

function sourceFamily(id: string, label: string, source: FeeFamilySource, type: string): FeeFamily {
  return family(
    id,
    label,
    `${label} reported by ${SOURCE_LABELS[source]}. Kept separate because no cross-source correspondence is established.`,
    source === "FINANCES" ? [type] : [],
    source === "DATA_KIOSK" ? [type] : [],
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
    "Deal participation and performance fees.",
    ["DEAL_FEES"],
    ["DEAL_PARTICIPATION_FEE", "DEAL_PERFORMANCE_FEE"],
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
    "FBA fulfillment fees and accepted spelling aliases. Corrections and reversals remain separate.",
    ["FBA_FULFILLMENT_FEES"],
    ["FBA_FULFILLMENT_FEE", "FBA_FULFILLMENT_FEES", "FBA_FULFILMENT_FEE"],
  ),
  family(
    "referral",
    "Referral fees",
    "Referral fees, separate from refunded referral fees and refund commission.",
    ["REFERRAL_FEES"],
    ["REFERRAL_FEE", "REFERRAL_FEES"],
  ),
  family(
    "refunded-referral",
    "Refunded referral fees",
    "Referral fees returned on refunds.",
    ["REFUNDED_REFERRAL_FEES"],
    ["REFUNDED_REFERRAL_FEE"],
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
    "FBA inventory reimbursements. Reversals remain a separate family.",
    ["INVENTORY_REIMBURSEMENTS"],
    ["FBA_INVENTORY_REIMBURSEMENT"],
  ),
  family(
    "digital-services",
    "Digital services fees",
    "Digital services fees across FBA and selling services.",
    ["DIGITAL_SERVICES_FEES"],
    ["DIGITAL_SERVICES_FEE_FBA", "DIGITAL_SERVICES_FEE_SOA"],
  ),
  sourceFamily("product-sales", "Product sales", "FINANCES", "PRODUCT_SALES"),
  sourceFamily("product-refunds", "Product refunds", "FINANCES", "PRODUCT_REFUNDS"),
  sourceFamily("net-product-sales", "Net product sales", "DATA_KIOSK", "NET_PRODUCT_SALES"),
  sourceFamily("shipping-credits", "Shipping credits", "FINANCES", "SHIPPING_CREDITS"),
  sourceFamily("shipping-refunds", "Shipping refunds", "FINANCES", "SHIPPING_REFUNDS"),
  sourceFamily("shipping-chargebacks", "Shipping chargebacks", "FINANCES", "SHIPPING_CHARGEBACKS"),
  sourceFamily("shipping-tax", "Shipping tax", "FINANCES", "SHIPPING_TAX"),
  sourceFamily("gift-wrap-credits", "Gift wrap credits", "FINANCES", "GIFT_WRAP_CREDITS"),
  sourceFamily("gift-wrap-tax", "Gift wrap tax", "FINANCES", "GIFT_WRAP_TAX"),
  sourceFamily(
    "gift-wrap-chargebacks",
    "Gift wrap chargebacks",
    "FINANCES",
    "GIFT_WRAP_CHARGEBACKS",
  ),
  sourceFamily("product-tax", "Product tax", "FINANCES", "PRODUCT_TAX"),
  sourceFamily("tax-withheld", "Tax withheld", "FINANCES", "TAX_WITHHELD"),
  sourceFamily("promotional-rebates", "Promotional rebates", "FINANCES", "PROMOTIONAL_REBATES"),
  sourceFamily("promotional-refunds", "Promotional refunds", "FINANCES", "PROMOTIONAL_REFUNDS"),
  sourceFamily("points", "Points", "FINANCES", "POINTS"),
  sourceFamily("restocking", "Restocking", "FINANCES", "RESTOCKING"),
  sourceFamily(
    "inventory-reimbursement-reversals",
    "Inventory reimbursement reversals",
    "FINANCES",
    "INVENTORY_REIMBURSEMENT_REVERSALS",
  ),
  sourceFamily(
    "fulfillment-fee-corrections",
    "Fulfillment fee corrections",
    "FINANCES",
    "FULFILLMENT_FEE_CORRECTIONS",
  ),
  sourceFamily(
    "fulfillment-fee-reversals",
    "Fulfillment fee reversals",
    "FINANCES",
    "FULFILLMENT_FEE_REVERSALS",
  ),
  sourceFamily("liquidation-proceeds", "Liquidation proceeds", "FINANCES", "LIQUIDATION_PROCEEDS"),
  sourceFamily("liquidation-fees", "Liquidation fees", "FINANCES", "LIQUIDATION_FEES"),
  sourceFamily(
    "liquidation-processing",
    "Liquidation processing fees",
    "DATA_KIOSK",
    "LIQUIDATION_PROCESSING_FEE",
  ),
  sourceFamily(
    "liquidation-referral",
    "Liquidation referral fees",
    "DATA_KIOSK",
    "LIQUIDATION_REFERRAL_FEE",
  ),
  sourceFamily(
    "data-kiosk-inbound-placement",
    "Inbound placement · Data Kiosk",
    "DATA_KIOSK",
    "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
  ),
  // Finances maps native FBAInboundConvenienceFee to INBOUND_PLACEMENT_FEES.
  family(
    "inbound-convenience",
    "Inbound convenience",
    "Finances INBOUND_PLACEMENT_FEES represents native FBAInboundConvenienceFee, paired with Data Kiosk inbound convenience fees. Placement service fees remain separate.",
    ["INBOUND_PLACEMENT_FEES"],
    ["FBA_INBOUND_CONVENIENCE_FEE"],
  ),
  sourceFamily("epr", "EPR fees", "FINANCES", "EPR_FEES"),
  sourceFamily("inbound-defect", "Inbound defect fees", "FINANCES", "INBOUND_DEFECT_FEES"),
  sourceFamily("mcf-credits", "MCF credits", "FINANCES", "MCF_CREDITS"),
  sourceFamily("vine", "Vine fees", "FINANCES", "VINE_FEES"),
  sourceFamily("other-adjustments", "Other adjustments", "FINANCES", "OTHER_ADJUSTMENTS"),
  sourceFamily("debt-recovery", "Debt recovery", "FINANCES", "DEBT_RECOVERY"),
  sourceFamily(
    "cross-account-adjustments",
    "Cross-account adjustments",
    "FINANCES",
    "CROSS_ACCOUNT_ADJUSTMENTS",
  ),
  sourceFamily("reserve-movements", "Reserve movements", "FINANCES", "RESERVE_MOVEMENTS"),
  sourceFamily("bank-transfers", "Bank transfers", "FINANCES", "BANK_TRANSFERS"),
  sourceFamily("tax-reclassification", "Tax reclassification", "FINANCES", "TAX_RECLASSIFICATION"),
  sourceFamily("zero-activity", "Zero activity", "FINANCES", "ZERO_ACTIVITY"),
  sourceFamily("cost-of-goods-sold", "Cost of goods sold", "DATA_KIOSK", "COST_OF_GOODS_SOLD"),
  sourceFamily(
    "mfn-fulfillment-cost",
    "MFN fulfillment cost",
    "DATA_KIOSK",
    "MFN_FULFILLMENT_COST",
  ),
  sourceFamily("mfn-storage-cost", "MFN storage cost", "DATA_KIOSK", "MFN_STORAGE_COST"),
  sourceFamily("miscellaneous-cost", "Miscellaneous cost", "DATA_KIOSK", "MISCELLANEOUS_COST"),
  sourceFamily(
    "shipping-to-amazon-cost",
    "Shipping to Amazon cost",
    "DATA_KIOSK",
    "SHIPPING_TO_AMAZON_COST",
  ),
];

const familiesById = new Map<string, FeeFamily>();
const familiesByType = new Map<string, FeeFamily>();
for (const entry of FEE_FAMILIES) {
  if (familiesById.has(entry.id)) throw new Error("Duplicate fee family ID");
  familiesById.set(entry.id, entry);
  for (const [source, types] of [
    ["FINANCES", entry.financesTypes],
    ["DATA_KIOSK", entry.dataKioskTypes],
  ] as const) {
    for (const type of types) {
      const key = JSON.stringify([source, type]);
      if (familiesByType.has(key))
        throw new Error("A source type belongs to multiple fee families");
      familiesByType.set(key, entry);
    }
  }
}

/** Unknown types retain their own exact source identity; nothing enters a shared fallback. */
export function resolveFeeFamily(source: string, type: string): FeeFamily {
  if (
    (source !== "FINANCES" && source !== "DATA_KIOSK") ||
    typeof type !== "string" ||
    type.length === 0 ||
    type.includes("\0")
  )
    throw new Error("Fee family comparison contains an invalid source type");
  return (
    familiesByType.get(JSON.stringify([source, type])) ??
    family(
      `source:${source}:${encodeURIComponent(type)}`,
      `${transactionTypeLabel(type)} · ${SOURCE_LABELS[source]}`,
      `Unrecognized ${SOURCE_LABELS[source]} type ${type}. Its amount remains separate; no cross-source correspondence is assumed.`,
      source === "FINANCES" ? [type] : [],
      source === "DATA_KIOSK" ? [type] : [],
    )
  );
}

function familyFromId(id: string): FeeFamily | null {
  const registered = familiesById.get(id);
  if (registered) return registered;
  const match = /^source:(FINANCES|DATA_KIOSK):(.+)$/.exec(id);
  if (!match) return null;
  try {
    const entry = resolveFeeFamily(match[1], decodeURIComponent(match[2]));
    return entry.id === id ? entry : null;
  } catch {
    return null;
  }
}

/** Saved navigation may omit malformed IDs, but request filtering validates strictly below. */
export function normalizeFeeFamilyIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input.filter((id): id is string => typeof id === "string" && familyFromId(id) !== null),
    ),
  ].sort();
}

function selectedFamilies(ids: readonly string[]): FeeFamily[] {
  if (!Array.isArray(ids)) throw new Error("Choose valid fee families");
  return [...new Set(ids)].map((id) => {
    const entry = typeof id === "string" ? familyFromId(id) : null;
    if (!entry) throw new Error("Choose valid fee families");
    return entry;
  });
}

/** Null means all types. A family without one source produces an empty set for that source. */
export function feeFamilyTypeSelections(ids: readonly string[]): {
  financesTypes: string[];
  dataKioskTypes: string[];
} | null {
  const selected = selectedFamilies(ids);
  if (!selected.length) return null;
  return {
    financesTypes: selected.flatMap((entry) => [...entry.financesTypes]),
    dataKioskTypes: selected.flatMap((entry) => [...entry.dataKioskTypes]),
  };
}

/** Retain selected options when the current period has no rows for them. */
export function buildFeeFamilyOptions(
  rows: readonly CanonicalRow[],
  selectedIds: readonly string[] = [],
): FeeFamily[] {
  const entries = new Map(selectedFamilies(selectedIds).map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const entry = resolveFeeFamily(row.source ?? "", row.component_type ?? "");
    entries.set(entry.id, entry);
  }
  return [...entries.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  );
}
