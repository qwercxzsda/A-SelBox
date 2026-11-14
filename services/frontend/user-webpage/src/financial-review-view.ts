import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { isCurrency, isJsonObject, requireCurrency } from "./api/validation.ts";
import { requireFinancialReviewYear, type FinancialReviewBounds } from "./api/financial-review.ts";
import { sumCompleteDecimals } from "./source-diagnostics.ts";
import { isMarketplace, requireMarketplace } from "./api/marketplaces.ts";
import { normalizeTypeFamilyIds } from "./transaction-type-family-catalog.ts";

export interface ReviewScope {
  year: string;
  marketplace: string;
  currency: string;
  families: string[];
}

interface MonthlyReviewView {
  selectedMonth: string | null;
  currency?: string;
}

export function createReviewScope(): ReviewScope {
  return { year: "", marketplace: "Amazon.com", currency: "", families: [] };
}

export function decodeReviewScope(value: unknown): ReviewScope {
  const scope = createReviewScope();
  if (!isJsonObject(value)) return scope;
  if (typeof value.year === "string" && value.year !== "") {
    try {
      requireFinancialReviewYear(value.year);
      scope.year = value.year;
    } catch {
      // Invalid saved years return to the latest available year.
    }
  }
  if (isMarketplace(value.marketplace)) {
    scope.marketplace = value.marketplace;
    if (isCurrency(value.currency)) scope.currency = value.currency;
  }
  scope.families = normalizeTypeFamilyIds(value.families);
  return scope;
}

/** Retain an explicitly selected year even when it has no source rows. */
export function resolveReviewYear(selected: string, bounds?: FinancialReviewBounds) {
  const year = selected || (bounds?.lastMonth?.slice(0, 4) ?? "");
  const firstYear = Number(bounds?.firstMonth?.slice(0, 4));
  const lastYear = Number(bounds?.lastMonth?.slice(0, 4));
  const years =
    firstYear && lastYear
      ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) =>
          String(lastYear - index).padStart(4, "0"),
        )
      : [];
  if (year && !years.includes(year)) years.push(year);
  return { year, years: years.sort((left, right) => right.localeCompare(left)) };
}

/** Automatic units use actual period rows; an explicit unit remains selected without matches. */
export function resolveReviewCurrency(selected: string, rows: readonly CanonicalRow[]) {
  const currencies = [...new Set([selected, ...rows.map((row) => row.currency ?? "")])]
    .filter(Boolean)
    .sort();
  const currency = selected || (currencies.includes("USD") ? "USD" : currencies[0]) || "";
  return { currency, currencies };
}

export function createMonthlyReviewView(): MonthlyReviewView {
  return { selectedMonth: null };
}

function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    requireCalendarDate(`${value}-01`);
    return true;
  } catch {
    return false;
  }
}

/** Store only selection; financial amounts always come from current sources. */
export function decodeMonthlyReviewView(value: unknown): MonthlyReviewView {
  return {
    selectedMonth: isJsonObject(value) && isMonth(value.selectedMonth) ? value.selectedMonth : null,
    ...(isJsonObject(value) && isCurrency(value.currency) ? { currency: value.currency } : {}),
  };
}

/** Accumulate one currency within the fetched year without rounding or filling source gaps. */
export function buildFinancialReviewTimeline(
  rows: readonly CanonicalRow[],
  currency: string,
): CanonicalRow[] {
  requireCurrency(currency);
  const months = new Set<string>();
  let year: string | null = null;
  let marketplace: string | null = null;
  const selected = rows
    .filter((row) => row.currency === currency)
    .map((row) => {
      requireMarketplace(row.marketplace_name);
      marketplace ??= row.marketplace_name;
      if (row.marketplace_name !== marketplace)
        throw new Error("Financial review timeline must use one marketplace");
      const month = row.month;
      if (!month || !isMonth(month.slice(0, 7)) || month !== `${month.slice(0, 7)}-01`)
        throw new Error("Financial review returned an invalid month");
      year ??= month.slice(0, 4);
      if (month.slice(0, 4) !== year)
        throw new Error("Financial review timeline must stay within one year");
      if (months.has(month)) throw new Error("Financial review repeated a monthly currency");
      if (row.difference !== null && typeof row.difference !== "string")
        throw new Error("Financial review is missing a monthly difference");
      months.add(month);
      return { row, month, difference: row.difference };
    });
  let running: string | null = "0";
  return selected
    .sort((left, right) => left.month.localeCompare(right.month))
    .map(({ row, difference }) => {
      running = sumCompleteDecimals([running, difference]);
      return { ...row, running_difference: running };
    });
}
