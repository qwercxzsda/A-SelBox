import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { requireMarketplace } from "./api/marketplaces.ts";
import { requireCurrency } from "./api/validation.ts";
import { sumExactDecimals } from "./decimal.ts";
import { differenceExact } from "./source-diagnostics.ts";
import { describeTypeFamilyCoverage } from "./financial-review-coverage.ts";
import {
  compareTypeFamilies,
  selectTypeFamilies,
  resolveTypeFamily,
} from "./transaction-type-family-catalog.ts";
import type { TypeFamily, TypeFamilySource } from "./transaction-type-families.ts";

interface FamilyTypeTotal {
  family: TypeFamily;
  source: TypeFamilySource;
  type: string;
  amount: string;
  rowCount: bigint;
  month: string;
  category: string;
  currency: string;
  marketplace: string;
}

function selectTypeTotals(
  rows: readonly CanonicalRow[],
  ids: readonly string[],
): FamilyTypeTotal[] {
  // Malformed selections must never turn into an unfiltered request or comparison.
  const selected = new Set(selectTypeFamilies(ids).map((family) => family.id));
  const seen = new Set<string>();
  return rows
    .map((row): FamilyTypeTotal => {
      const source = row.source ?? "";
      const type = row.component_type ?? "";
      const family = resolveTypeFamily(source, type);
      const month = row.month ?? "";
      requireCalendarDate(month);
      if (!month.endsWith("-01"))
        throw new Error("Type family comparison contains an invalid month");
      const category = row.category ?? "";
      if (!["FINANCES", "DATA_KIOSK", "SELBOX", "ANALYSIS_ONLY"].includes(category))
        throw new Error("Type family comparison contains an invalid category");
      const marketplace = row.marketplace_name;
      requireMarketplace(marketplace);
      const currency = row.currency ?? "";
      requireCurrency(currency);
      const key = JSON.stringify([month, category, marketplace, currency, source, type]);
      if (seen.has(key)) throw new Error("Type family comparison contains a duplicate type total");
      seen.add(key);
      if (typeof row.amount !== "string")
        throw new Error("Type family comparison contains a missing amount");
      const amount = sumExactDecimals([row.amount]);
      if (amount === null) throw new Error("Type family comparison contains an invalid amount");
      if (typeof row.row_count !== "string" || !/^(0|[1-9]\d*)$/.test(row.row_count))
        throw new Error("Type family comparison contains an invalid row count");
      return {
        family,
        source: source as TypeFamilySource,
        type,
        amount,
        rowCount: BigInt(row.row_count),
        month,
        category,
        currency,
        marketplace,
      };
    })
    .filter((row) => selected.size === 0 || selected.has(row.family.id));
}

function sourceTotals(rows: readonly FamilyTypeTotal[], source: TypeFamilySource) {
  const selected = rows.filter((row) => row.source === source);
  return {
    amount: sumExactDecimals(selected.map((row) => row.amount)) ?? "0",
    rowCount: selected.reduce((count, row) => count + row.rowCount, 0n).toString(),
  };
}

function sourceTypes(rows: readonly FamilyTypeTotal[], source: TypeFamilySource): string {
  return (
    [...new Set(rows.filter((row) => row.source === source).map((row) => row.type))]
      .sort()
      .join(", ") || "—"
  );
}

function comparison(rows: readonly FamilyTypeTotal[]): CanonicalRow {
  const finances = sourceTotals(rows, "FINANCES");
  const kiosk = sourceTotals(rows, "DATA_KIOSK");
  return {
    finances_amount: finances.amount,
    data_kiosk_amount: kiosk.amount,
    difference: differenceExact(finances.amount, kiosk.amount),
    finances_row_count: finances.rowCount,
    data_kiosk_row_count: kiosk.rowCount,
  };
}

/** Compare every observed family, including zero and source-only totals, in one currency. */
export function buildFinancialReviewFamilies(
  rows: readonly CanonicalRow[],
  ids: readonly string[] = [],
): CanonicalRow[] {
  const selected = selectTypeTotals(rows, ids);
  if (new Set(selected.map((row) => row.marketplace)).size > 1)
    throw new Error("Type family comparison must use one marketplace");
  if (new Set(selected.map((row) => row.currency)).size > 1)
    throw new Error("Type family comparison must use one currency");
  const groups = new Map<string, FamilyTypeTotal[]>();
  for (const row of selected) {
    const group = groups.get(row.family.id) ?? [];
    group.push(row);
    groups.set(row.family.id, group);
  }
  return [...groups.values()]
    .sort((left, right) => compareTypeFamilies(left[0].family, right[0].family))
    .map((group) => ({
      family_id: group[0].family.id,
      family: group[0].family.label,
      description: group[0].family.description,
      currency: group[0].currency,
      marketplace_name: group[0].marketplace,
      ...comparison(group),
      coverage: describeTypeFamilyCoverage(group, group[0].family),
      finances_definition: group[0].family.financesTypes.join(", ") || "No counterpart defined",
      data_kiosk_definition: group[0].family.dataKioskTypes.join(", ") || "No counterpart defined",
      finances_types: sourceTypes(group, "FINANCES"),
      data_kiosk_types: sourceTypes(group, "DATA_KIOSK"),
    }));
}

/** Sum selected type families by their original month/category/currency; never fill source gaps. */
export function buildFinancialReviewFamilyMonths(
  rows: readonly CanonicalRow[],
  ids: readonly string[] = [],
): CanonicalRow[] {
  const groups = new Map<string, FamilyTypeTotal[]>();
  for (const row of selectTypeTotals(rows, ids)) {
    const key = JSON.stringify([row.month, row.category, row.marketplace, row.currency]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      month: group[0].month,
      category: group[0].category,
      currency: group[0].currency,
      marketplace_name: group[0].marketplace,
      ...comparison(group),
    }))
    .sort(
      (left, right) =>
        left.month.localeCompare(right.month) ||
        left.marketplace_name.localeCompare(right.marketplace_name) ||
        left.currency.localeCompare(right.currency) ||
        left.category.localeCompare(right.category),
    );
}
