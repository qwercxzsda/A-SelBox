import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { isCurrency, isJsonObject, requireCurrency } from "./api/validation.ts";
import { requireFinancialReviewYear } from "./api/financial-review.ts";
import { sumExactDecimals } from "./decimal.ts";
import { isMarketplace, requireMarketplace } from "./api/marketplaces.ts";
import { normalizeFeeFamilyIds } from "./fee-family-catalog.ts";

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
  scope.families = normalizeFeeFamilyIds(value.families);
  return scope;
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
      if (typeof row.difference !== "string")
        throw new Error("Financial review is missing a monthly difference");
      months.add(month);
      return { row, month, difference: row.difference };
    });
  let running: string | null = null;
  return selected
    .sort((left, right) => left.month.localeCompare(right.month))
    .map(({ row, difference }) => {
      running = sumExactDecimals([running, difference]);
      return { ...row, running_difference: running };
    });
}
