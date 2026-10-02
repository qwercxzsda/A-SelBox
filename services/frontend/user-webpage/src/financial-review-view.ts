import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { isJsonObject } from "./api/validation.ts";
import type { FinancialReviewPageCursor } from "./api/financial-review.ts";
import { PAGE_SIZES } from "./view-model.ts";

export interface MonthlyReviewView {
  cursors: (FinancialReviewPageCursor | null)[];
  pageIndex: number;
  pageSize: number;
  selectedMonth: string | null;
  filterMonth: string;
}

export function createMonthlyReviewView(): MonthlyReviewView {
  return {
    cursors: [null],
    pageIndex: 0,
    pageSize: PAGE_SIZES[0],
    selectedMonth: null,
    filterMonth: "",
  };
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

/** Store only navigation and selection; financial amounts always come from current sources. */
export function decodeMonthlyReviewView(value: unknown): MonthlyReviewView {
  if (!isJsonObject(value)) return createMonthlyReviewView();
  const filterMonth = isMonth(value.filterMonth) ? value.filterMonth : "";
  const savedPageSize = PAGE_SIZES.find((size) => size === value.pageSize);
  const pageSize = savedPageSize ?? PAGE_SIZES[0];
  const cursors: (FinancialReviewPageCursor | null)[] = [null];
  if (
    savedPageSize &&
    Array.isArray(value.cursors) &&
    value.cursors[0] === null &&
    value.cursors.length <= 1000
  ) {
    for (const cursor of value.cursors.slice(1)) {
      const previous = cursors.at(-1);
      if (
        !isJsonObject(cursor) ||
        !isMonth(cursor.month) ||
        typeof cursor.offset !== "number" ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 ||
        !Number.isSafeInteger(cursor.offset + pageSize + 1) ||
        (filterMonth !== "" && cursor.month !== filterMonth) ||
        (previous &&
          (cursor.month > previous.month ||
            (cursor.month === previous.month && cursor.offset <= previous.offset)))
      )
        break;
      cursors.push({ month: cursor.month, offset: cursor.offset });
    }
  }
  return {
    cursors,
    pageSize,
    pageIndex:
      typeof value.pageIndex === "number" &&
      Number.isSafeInteger(value.pageIndex) &&
      value.pageIndex >= 0 &&
      value.pageIndex < cursors.length
        ? value.pageIndex
        : 0,
    selectedMonth: isMonth(value.selectedMonth) ? value.selectedMonth : null,
    filterMonth,
  };
}

export function groupFinancialReviewMonths(rows: CanonicalRow[]) {
  const groups = new Map<string, CanonicalRow[]>();
  for (const row of rows) {
    const month = row.month?.slice(0, 7);
    if (!month) continue;
    const currencies = groups.get(month) ?? [];
    currencies.push(row);
    groups.set(month, currencies);
  }
  return [...groups].map(([month, currencies]) => ({ month, currencies }));
}
