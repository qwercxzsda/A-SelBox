import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { requireMarketplace } from "./api/marketplaces.ts";
import { requireCurrency } from "./api/validation.ts";
import { sumExactDecimals } from "./decimal.ts";
import { buildFinancialReviewFamilies } from "./financial-review-families.ts";
import { buildFeeFamilyOptions, selectFeeFamilies } from "./fee-family-catalog.ts";

interface FinancialReviewFamilyPoint {
  month: string;
  difference: string;
  runningDifference: string;
}

export interface FinancialReviewFamilySeries {
  id: string;
  label: string;
  sourceOnlyLabel?: "Finances only" | "Data Kiosk only";
  color: string;
  dash: string;
  points: FinancialReviewFamilyPoint[];
}

interface FamilyVisual {
  color: string;
  dash: string;
}

// Common families have explicit identities; neither selection order nor a new
// registry entry may recolor a family. Dashes also distinguish running lines.
const COMMON_VISUALS: Readonly<Record<string, FamilyVisual>> = {
  "monthly-storage": { color: "#2563eb", dash: "" },
  "aged-storage": { color: "#d97706", dash: "6 3" },
  "sponsored-products": { color: "#7c3aed", dash: "2 3" },
  coupons: { color: "#0f766e", dash: "8 3 2 3" },
  deals: { color: "#be185d", dash: "10 3" },
  disposal: { color: "#92400e", dash: "4 2" },
  removal: { color: "#475569", dash: "1 3" },
  labeling: { color: "#15803d", dash: "6 2 1 2" },
  "inbound-transportation": { color: "#0891b2", dash: "12 3 2 3" },
  subscription: { color: "#a21caf", dash: "3 2 8 2" },
  "sponsored-brands": { color: "#dc2626", dash: "4 4" },
  "sponsored-display": { color: "#4d7c0f", dash: "2 2 6 2" },
};
const FALLBACK_DASHES = ["", "6 3", "2 3", "8 3 2 3", "10 3", "4 2", "1 3", "6 2 1 2"];

export function feeFamilyVisual(id: string): FamilyVisual {
  if (Object.hasOwn(COMMON_VISUALS, id)) return { ...COMMON_VISUALS[id] };
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  const hue = hash % 360;
  const saturation = 52 + ((hash >>> 9) % 19);
  const lightness = 30 + ((hash >>> 17) % 13);
  return {
    color: `hsl(${String(hue)} ${String(saturation)}% ${String(lightness)}%)`,
    dash: FALLBACK_DASHES[(hash >>> 24) % FALLBACK_DASHES.length],
  };
}

function anchorMonths(rows: readonly CanonicalRow[]): string[] {
  const first = rows[0];
  const currency = first.currency ?? "";
  requireMarketplace(first.marketplace_name);
  requireCurrency(currency);
  const months = new Set<string>();
  let year = "";
  for (const row of rows) {
    const month = row.month ?? "";
    requireCalendarDate(month);
    year ||= month.slice(0, 4);
    if (
      !month.endsWith("-01") ||
      month.slice(0, 4) !== year ||
      row.currency !== currency ||
      row.marketplace_name !== first.marketplace_name ||
      row.category !== first.category ||
      months.has(month)
    )
      throw new Error("Family chart overview must contain unique months in one year and scope");
    months.add(month);
  }
  return [...months].sort();
}

/** Exact values only. Zero-fill families inside observed months, never missing overview months. */
export function buildFinancialReviewFamilySeries(
  typeRows: readonly CanonicalRow[],
  overviewRows: readonly CanonicalRow[],
  ids: readonly string[] = [],
): FinancialReviewFamilySeries[] {
  const selected = new Set(selectFeeFamilies(ids).map((family) => family.id));
  if (!overviewRows.length) return [];
  const months = anchorMonths(overviewRows);
  const scope = overviewRows[0];
  const year = months[0].slice(0, 4);
  const rowsByMonth = new Map<string, CanonicalRow[]>();
  for (const row of typeRows) {
    if (
      row.currency !== scope.currency ||
      row.marketplace_name !== scope.marketplace_name ||
      row.category !== scope.category ||
      row.month?.slice(0, 4) !== year
    )
      throw new Error("Family chart source types must match the overview year and scope");
    const month = row.month;
    const group = rowsByMonth.get(month) ?? [];
    group.push(row);
    rowsByMonth.set(month, group);
  }
  const totalsByMonth = new Map(
    [...rowsByMonth].map(([month, rows]) => [
      month,
      new Map(
        buildFinancialReviewFamilies(rows, ids).map((row) => [row.family_id, row.difference]),
      ),
    ]),
  );
  return buildFeeFamilyOptions(typeRows, ids)
    .filter((family) => !selected.size || selected.has(family.id))
    .map((family) => {
      // Membership defines source-only families; missing observed rows do not.
      const sourceOnlyLabel: FinancialReviewFamilySeries["sourceOnlyLabel"] =
        family.financesTypes.length === 0
          ? "Data Kiosk only"
          : family.dataKioskTypes.length === 0
            ? "Finances only"
            : undefined;
      let runningDifference = "0";
      const points = months.map((month) => {
        const difference = totalsByMonth.get(month)?.get(family.id) ?? "0";
        runningDifference = sumExactDecimals([runningDifference, difference]) ?? "0";
        return { month, difference, runningDifference };
      });
      return {
        id: family.id,
        label: family.label,
        sourceOnlyLabel,
        ...feeFamilyVisual(family.id),
        points,
      };
    });
}
