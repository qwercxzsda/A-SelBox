import type { TransactionTrendGranularity } from "./api/types.ts";
import {
  selectedPeriod,
  summaryPeriods,
  type DateRange,
  type PeriodDefinition,
} from "./summary-periods.ts";

export type TransactionSummaryView = "totals" | TransactionTrendGranularity;

export const TRANSACTION_TREND_LABELS = {
  day: "Daily trends",
  week: "Weekly trends",
} as const;

export const TRANSACTION_SUMMARY_VIEWS = [
  { value: "totals", label: "Current totals" },
  { value: "day", label: TRANSACTION_TREND_LABELS.day },
  { value: "week", label: TRANSACTION_TREND_LABELS.week },
] as const;

export function decodeTransactionSummaryView(value: unknown): TransactionSummaryView {
  return value === "day" || value === "week" ? value : "totals";
}

/** Explicit list dates take precedence, including one-sided ranges. */
export function transactionTrendPeriod(
  latestDate: string | null,
  granularity: TransactionTrendGranularity,
  dates: DateRange,
): PeriodDefinition | null {
  const selected = selectedPeriod(dates);
  if (selected) return selected;
  const periods = summaryPeriods(latestDate);
  const end = granularity === "day" ? periods.day?.range.to : periods.month?.range.to;
  if (!end) return null;
  const start = new Date(`${end}T00:00:00Z`);
  if (granularity === "day") start.setUTCDate(start.getUTCDate() - 29);
  else {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 11);
  }
  return selectedPeriod({ from: start.toISOString().slice(0, 10), to: end });
}
