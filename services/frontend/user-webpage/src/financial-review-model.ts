import {
  REVIEW_REASONS,
  SELBOX_GROUPS,
  type ReviewMeasure,
  type ReviewMonthRow,
  type ReviewReason,
  type ReviewScope,
  type SelboxGroup,
} from "./api/financial-review.ts";
import { formatRecordMonth } from "./date-display.ts";
import { formatExactMoney, sumExactDecimals } from "./decimal.ts";

/** An amount including tax, and the tax within it. Both are exact decimals. */
export interface ReviewAmount {
  amount: string;
  tax: string;
}

export interface ReviewBreakdown<Code extends string> extends ReviewAmount {
  code: Code;
  count: number;
}

export type ReviewTotalKey = "finances" | "company" | "selbox" | "difference";
export type ReviewTotals = Record<ReviewTotalKey, ReviewAmount>;

export interface ReviewMonth {
  /** YYYY-MM */
  month: string;
  totals: ReviewTotals;
  /** The difference since January, including tax. */
  runningDifference: string;
  /** Present reasons and groups only, in their constant order. */
  reasons: ReviewBreakdown<ReviewReason>[];
  groups: ReviewBreakdown<SelboxGroup>[];
}

export interface ReviewYear extends ReviewScope {
  currency: string;
  /** Months with activity, January first. */
  months: ReviewMonth[];
  totals: ReviewTotals;
  /** Each present reason's year total. */
  reasons: ReviewBreakdown<ReviewReason>[];
}

const TOTAL_MEASURES: Record<ReviewTotalKey, ReviewMeasure> = {
  finances: "FINANCES",
  company: "COMPANY",
  selbox: "SELBOX",
  difference: "DIFFERENCE",
};

function sum(values: Iterable<string>): string {
  return sumExactDecimals(values) ?? "0";
}

function addAmounts(amounts: readonly ReviewAmount[]): ReviewAmount {
  return {
    amount: sum(amounts.map(({ amount }) => amount)),
    tax: sum(amounts.map(({ tax }) => tax)),
  };
}

function totalsFrom(total: (key: ReviewTotalKey) => ReviewAmount): ReviewTotals {
  return {
    finances: total("finances"),
    company: total("company"),
    selbox: total("selbox"),
    difference: total("difference"),
  };
}

/** A row's amount including tax, labelled with its reason or group. */
function entry<Code extends string>(row: ReviewMonthRow, code: Code | null) {
  return {
    code,
    amount: sum([row.baseAmount, row.taxAmount]),
    tax: row.taxAmount,
    count: row.count,
  };
}

/** Sum the entries of each code; codes keep their constant order and absent codes are left out. */
function breakdowns<Code extends string>(
  codes: readonly Code[],
  entries: readonly (ReviewAmount & { code: Code | null; count: number })[],
): ReviewBreakdown<Code>[] {
  return codes.flatMap((code) => {
    const matching = entries.filter((item) => item.code === code);
    if (!matching.length) return [];
    const count = matching.reduce((total, item) => total + item.count, 0);
    return [{ code, ...addAmounts(matching), count }];
  });
}

/** Finances equals Company + SelBox + Difference for base and for tax, or the review fails. */
function requireBalance(month: string, rows: readonly ReviewMonthRow[], currency: string) {
  for (const [part, label] of [
    ["baseAmount", "base"],
    ["taxAmount", "tax"],
  ] as const) {
    const finances = sum(rows.filter((row) => row.measure === "FINANCES").map((row) => row[part]));
    const outcomes = sum(rows.filter((row) => row.measure !== "FINANCES").map((row) => row[part]));
    if (finances !== outcomes)
      throw new Error(
        `${formatRecordMonth(month)} does not add up: Finances ${label} ${formatExactMoney(finances, currency)}, but Company amounts, SelBox types and Differences ${formatExactMoney(outcomes, currency)}.`,
      );
  }
}

function requireUniqueMeasures(rows: readonly ReviewMonthRow[]) {
  const keys = new Set(
    rows.map((row) => [row.month, row.measure, row.reason, row.selboxGroup].join(":")),
  );
  if (keys.size !== rows.length) throw new Error("Financial review repeated a monthly measure");
}

function buildMonth(month: string, rows: readonly ReviewMonthRow[], running: string): ReviewMonth {
  const totals = totalsFrom((key) =>
    addAmounts(
      rows.filter((row) => row.measure === TOTAL_MEASURES[key]).map((row) => entry(row, null)),
    ),
  );
  return {
    month,
    totals,
    runningDifference: sum([running, totals.difference.amount]),
    reasons: breakdowns(
      REVIEW_REASONS,
      rows.map((row) => entry(row, row.reason)),
    ),
    groups: breakdowns(
      SELBOX_GROUPS,
      rows.map((row) => entry(row, row.selboxGroup)),
    ),
  };
}

/** One marketplace-year in its one currency, checked month by month. */
export function buildReviewYear(
  rows: readonly ReviewMonthRow[],
  scope: ReviewScope & { currency: string },
): ReviewYear {
  requireUniqueMeasures(rows);
  const months: ReviewMonth[] = [];
  for (const month of [...new Set(rows.map((row) => row.month))].sort()) {
    const monthRows = rows.filter((row) => row.month === month);
    requireBalance(month, monthRows, scope.currency);
    months.push(buildMonth(month, monthRows, months.at(-1)?.runningDifference ?? "0"));
  }
  return {
    ...scope,
    months,
    totals: totalsFrom((key) => addAmounts(months.map((month) => month.totals[key]))),
    reasons: breakdowns(
      REVIEW_REASONS,
      months.flatMap((month) => month.reasons),
    ),
  };
}
