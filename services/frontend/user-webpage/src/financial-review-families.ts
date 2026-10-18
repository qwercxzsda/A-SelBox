import type { CanonicalRow } from "./api/types.ts";
import { sumExactDecimals } from "./decimal.ts";

// Explicit fee identities already recognized by the source taxonomy. These are
// diagnostic families, not proof of equal billing dates, allocation or coverage.
// Advertising and ambiguous convenience/placement labels deliberately stay unpaired.
const FAMILIES = [
  ["Coupons", ["COUPON_FEES"], ["COUPON_PARTICIPATION_FEE", "COUPON_PERFORMANCE_FEE"]],
  ["Deals", ["DEAL_FEES"], ["DEAL_PARTICIPATION_FEE", "DEAL_PERFORMANCE_FEE"]],
  ["Monthly storage", ["STORAGE_FEES"], ["FBA_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"]],
  [
    "Aged storage",
    ["AGED_STORAGE_FEES"],
    ["LONG_TERM_STORAGE_FEE", "FBA_AGED_INVENTORY_SURCHARGE"],
  ],
  ["Disposal", ["DISPOSAL_FEES"], ["DISPOSAL_FEE"]],
  ["Removal", ["REMOVAL_FEES"], ["REMOVAL_FEE"]],
  ["Labeling", ["LABELING_FEES"], ["LABELING_FEE"]],
  [
    "Inbound transportation",
    ["INBOUND_TRANSPORTATION_FEES", "INBOUND_TRANSPORTATION_PROGRAM_FEES"],
    ["FBA_INBOUND_TRANSPORTATION_FEE", "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE"],
  ],
  ["Subscription", ["SUBSCRIPTION_FEES"], ["SUBSCRIPTION_FEE"]],
] as const;

function exactSum(rows: CanonicalRow[]): string {
  if (!rows.length) return "0";
  if (rows.some((row) => typeof row.amount !== "string"))
    throw new Error("Fee family comparison contains a missing amount");
  const result = sumExactDecimals(rows.map((row) => row.amount));
  if (result === null) throw new Error("Fee family comparison contains an invalid amount");
  return result;
}

function negate(value: string): string {
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

export function buildFinancialReviewFamilies(rows: CanonicalRow[]): {
  families: CanonicalRow[];
  unmatched: CanonicalRow[];
} {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.source ?? ""}:${row.component_type ?? ""}`;
    if (
      !["FINANCES", "DATA_KIOSK"].includes(row.source ?? "") ||
      !row.component_type ||
      seen.has(key)
    )
      throw new Error("Fee family comparison contains an invalid or duplicate type");
    seen.add(key);
  }
  const paired = new Set<CanonicalRow>();
  const families = FAMILIES.flatMap(([family, financesTypes, kioskTypes]) => {
    const finances = rows.filter(
      (row) =>
        row.source === "FINANCES" &&
        (financesTypes as readonly string[]).includes(row.component_type ?? ""),
    );
    const kiosk = rows.filter(
      (row) =>
        row.source === "DATA_KIOSK" &&
        (kioskTypes as readonly string[]).includes(row.component_type ?? ""),
    );
    if (!finances.length && !kiosk.length) return [];
    for (const row of [...finances, ...kiosk]) paired.add(row);
    const financesAmount = exactSum(finances);
    const kioskAmount = exactSum(kiosk);
    const difference = sumExactDecimals([financesAmount, negate(kioskAmount)]);
    if (difference === null) throw new Error("Fee family difference cannot be represented");
    return [
      {
        family,
        finances_amount: financesAmount,
        data_kiosk_amount: kioskAmount,
        difference,
        coverage: !finances.length
          ? "No Finances rows"
          : !kiosk.length
            ? "No Data Kiosk rows"
            : "Both sources",
        finances_types: finances.map((row) => row.component_type).join(", ") || "—",
        data_kiosk_types: kiosk.map((row) => row.component_type).join(", ") || "—",
      },
    ];
  });
  // Validate even unpaired values; no missing/malformed amount silently becomes zero.
  const unmatched = rows.filter((row) => !paired.has(row));
  exactSum(unmatched);
  return { families, unmatched };
}
