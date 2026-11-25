import type { ReviewReason } from "./api/financial-review.ts";
import { chartLines, chartScale } from "./amount-trend-projection.ts";
import { compareAbsoluteDecimals, sumExactDecimals } from "./decimal.ts";
import type { ReviewBreakdown, ReviewYear } from "./financial-review-model.ts";

/**
 * One fixed color per reason, never assigned by order. The order of REVIEW_REASONS is also the
 * stacking order, so neighbouring reasons have colors validated as distinct for color vision
 * deficiencies.
 */
export const REASON_COLORS: Record<ReviewReason, string> = {
  NO_ASSIGNMENT: "#2a78d6",
  REFERENCE_NOT_FOUND: "#eb6834",
  ROUNDING: "#1baf7a",
  TOTALS_DIFFER: "#eda100",
  CHARGED_IN_ANOTHER_MONTH: "#e87ba4",
  SPLIT_OWNERSHIP: "#008300",
  LEDGER_MONTH_NOT_LOADED: "#6250d6",
  NOT_IN_LEDGER: "#e34948",
  NO_ID_ON_CHARGE: "#9c4f96",
};

export interface DifferenceSegment {
  reason: ReviewReason;
  amount: string;
  top: number;
  height: number;
}

export interface DifferencePoint {
  /** YYYY-MM */
  month: string;
  difference: string;
  runningDifference: string;
  monthlyY: number;
  runningY: number;
  segments: DifferenceSegment[];
}

export interface DifferenceChart {
  /** January onward; null marks a month without activity. */
  points: (DifferencePoint | null)[];
  reasons: ReviewReason[];
  lines: string[];
  zero: number;
  ticks: { value: string; y: number }[];
}

interface ExactSegment {
  reason: ReviewReason;
  amount: string;
  start: string;
  end: string;
}

function add(values: string[]): string {
  return sumExactDecimals(values) ?? "0";
}

/** Positive amounts stack up from zero and negative amounts stack down, in reason order. */
export function stackReasons(
  reasons: readonly ReviewBreakdown<ReviewReason>[],
  difference: string,
): ExactSegment[] {
  let positive = "0";
  let negative = "0";
  const segments = reasons.map(({ code, amount }) => {
    const isNegative = amount.startsWith("-");
    const start = isNegative ? negative : positive;
    const end = add([start, amount]);
    if (isNegative) negative = end;
    else positive = end;
    return { reason: code, amount, start, end };
  });
  if (add([positive, negative]) !== add([difference]))
    throw new Error("Reason amounts differ from the monthly difference");
  return segments;
}

/** Reasons by absolute year total, largest first; ties keep the constant order. */
export function legendReasons(reasons: readonly ReviewBreakdown<ReviewReason>[]) {
  return [...reasons].sort((left, right) => compareAbsoluteDecimals(right.amount, left.amount));
}

/**
 * Screen positions only; exact amounts stay in the review model. Null only when every month's
 * every reason is zero: a reason's year total can net to zero while its months differ.
 */
export function projectDifferenceChart(
  review: ReviewYear,
  monthCount: number,
): DifferenceChart | null {
  if (review.months.every((month) => month.reasons.every(({ amount }) => amount === "0")))
    return null;
  const months = review.months.map((month) => ({
    month,
    index: Number(month.month.slice(5, 7)) - 1,
    segments: stackReasons(month.reasons, month.totals.difference.amount),
  }));
  const periodCount = Math.max(monthCount, (months.at(-1)?.index ?? 0) + 1);
  const { y, ticks } = chartScale(
    months.flatMap(({ month, segments }) => [
      month.totals.difference.amount,
      month.runningDifference,
      ...segments.flatMap(({ start, end }) => [start, end]),
    ]),
  );
  const points: DifferenceChart["points"] = Array.from({ length: periodCount }, () => null);
  for (const { month, index, segments } of months)
    points[index] = {
      month: month.month,
      difference: month.totals.difference.amount,
      runningDifference: month.runningDifference,
      monthlyY: y(month.totals.difference.amount),
      runningY: y(month.runningDifference),
      segments: segments.map(({ reason, amount, start, end }) => ({
        reason,
        amount,
        top: Math.min(y(start), y(end)),
        height: Math.abs(y(start) - y(end)),
      })),
    };
  return {
    points,
    reasons: review.reasons.map(({ code }) => code),
    lines: chartLines(
      months.map(({ index }) => index),
      months.map(({ month }) => y(month.runningDifference)),
      periodCount,
    ),
    zero: y("0"),
    ticks,
  };
}
