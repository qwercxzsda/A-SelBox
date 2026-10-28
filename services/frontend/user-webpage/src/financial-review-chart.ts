import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { compareAbsoluteDecimals, sumExactDecimals } from "./decimal.ts";
import type { FinancialReviewFamilySeries } from "./financial-review-family-series.ts";

export interface ReviewFamilySegment {
  familyId: string;
  difference: string;
  runningDifference: string;
  top: number;
  height: number;
  runningY: number;
}

export interface ReviewChartPoint {
  month: string;
  row: CanonicalRow;
  monthlyY: number;
  runningY: number;
  segments: ReviewFamilySegment[];
}

export interface ReviewChartFamily extends Omit<FinancialReviewFamilySeries, "points"> {
  lines: string[];
}

export interface ReviewChart {
  months: (ReviewChartPoint | null)[];
  lines: string[];
  zero: number;
  families: ReviewChartFamily[];
  ticks: { value: string; y: number }[];
}

interface ExactChartPoint {
  row: CanonicalRow;
  month: string;
  monthIndex: number;
  monthly: string;
  running: string;
}

interface ExactFamilySegment {
  familyId: string;
  difference: string;
  runningDifference: string;
  start: string;
  end: string;
}

function exactAmount(value: string | null | undefined): string {
  if (typeof value !== "string") throw new Error("Chart amount is missing");
  const amount = sumExactDecimals([value]);
  if (amount === null) throw new Error("Chart amount is invalid");
  return amount;
}

function chartPoints(rows: readonly CanonicalRow[]): ExactChartPoint[] {
  let year = "";
  const seen = new Set<string>();
  return rows
    .map((row) => {
      const month = row.month ?? "";
      requireCalendarDate(month);
      year ||= month.slice(0, 4);
      if (!month.endsWith("-01") || month.slice(0, 4) !== year || seen.has(month))
        throw new Error("Chart months must be unique and within one year");
      seen.add(month);
      return {
        row,
        month,
        monthIndex: Number(month.slice(5, 7)) - 1,
        monthly: exactAmount(row.difference),
        running: exactAmount(row.running_difference),
      };
    })
    .sort((left, right) => left.monthIndex - right.monthIndex);
}

function familyStacks(
  points: readonly ExactChartPoint[],
  series: readonly FinancialReviewFamilySeries[],
): ExactFamilySegment[][] {
  const ids = new Set(series.map((family) => family.id));
  if (ids.size !== series.length) throw new Error("Chart repeats a fee family");
  const familyPoints = series.map((family) => {
    const months = new Map(family.points.map((point) => [point.month, point]));
    if (months.size !== points.length || months.size !== family.points.length)
      throw new Error("Family chart months differ from the overview");
    return months;
  });
  return points.map((point) => {
    let positive = "0";
    let negative = "0";
    let monthly = "0";
    let running = "0";
    const segments = series.map((family, index) => {
      const familyPoint = familyPoints[index].get(point.month);
      if (!familyPoint) throw new Error("Family chart month is missing");
      const difference = exactAmount(familyPoint.difference);
      const runningDifference = exactAmount(familyPoint.runningDifference);
      monthly = sumExactDecimals([monthly, difference]) ?? "0";
      running = sumExactDecimals([running, runningDifference]) ?? "0";
      const isNegative = difference.startsWith("-");
      const start = isNegative ? negative : positive;
      const end = sumExactDecimals([start, difference]) ?? "0";
      if (isNegative) negative = end;
      else positive = end;
      return { familyId: family.id, difference, runningDifference, start, end };
    });
    // Separate reads can briefly span different source revisions. Do not draw
    // colored components that disagree with the unchanged overview totals.
    if (monthly !== point.monthly || running !== point.running)
      throw new Error("Family chart totals differ from the overview");
    return segments;
  });
}

function chartScale(values: readonly string[]) {
  let minimum = "0";
  let maximum = "0";
  for (const value of values) {
    if (value.startsWith("-")) {
      if (compareAbsoluteDecimals(value, minimum) > 0) minimum = value;
    } else if (compareAbsoluteDecimals(value, maximum) > 0) maximum = value;
  }
  const numericMinimum = Number(minimum);
  const numericMaximum = Number(maximum);
  if (!Number.isFinite(numericMinimum) || !Number.isFinite(numericMaximum))
    throw new Error("Chart values cannot be projected");
  const magnitude = Math.max(1, Math.abs(numericMinimum), numericMaximum);
  const low = numericMinimum / magnitude;
  const high = numericMaximum / magnitude;
  const padding = (high - low || 1) * 0.12;
  const y = (value: string) =>
    ((high + padding - Number(value) / magnitude) / (high - low + padding * 2)) * 100;
  const ticks = [...new Set([maximum, "0", minimum])]
    .map((value) => ({ value, y: y(value) }))
    // A small opposite-sign value may sit directly beside zero on a shared scale.
    .filter((tick) => tick.value === "0" || Math.abs(tick.y - y("0")) >= 8);
  return { y, ticks };
}

function chartLines(
  points: readonly ExactChartPoint[],
  positions: readonly number[],
  monthCount: number,
): string[] {
  const segments: string[][] = [];
  for (const [index, point] of points.entries()) {
    if (index === 0 || points[index - 1].monthIndex !== point.monthIndex - 1) segments.push([]);
    segments[segments.length - 1].push(
      `${String(((point.monthIndex + 0.5) / monthCount) * 1000)},${String(positions[index] * 2)}`,
    );
  }
  return segments.map((segment) => segment.join(" "));
}

/** Approximate screen coordinates only; never use this projection for financial totals. */
export function projectFinancialReviewChart(
  rows: readonly CanonicalRow[],
  series?: readonly FinancialReviewFamilySeries[],
): ReviewChart | null {
  if (!rows.length) return null;
  try {
    const points = chartPoints(rows);
    const stacks = series === undefined ? points.map(() => []) : familyStacks(points, series);
    const { y, ticks } = chartScale([
      ...points.flatMap((point) => [point.monthly, point.running]),
      ...stacks.flatMap((segments) =>
        segments.flatMap((segment) => [segment.start, segment.end, segment.runningDifference]),
      ),
    ]);
    const monthCount = points[points.length - 1].monthIndex + 1;
    const months: ReviewChart["months"] = Array.from({ length: monthCount }, () => null);
    for (const [index, point] of points.entries()) {
      months[point.monthIndex] = {
        month: point.month.slice(0, 7),
        row: point.row,
        monthlyY: y(point.monthly),
        runningY: y(point.running),
        segments: stacks[index].map((segment) => ({
          familyId: segment.familyId,
          difference: segment.difference,
          runningDifference: segment.runningDifference,
          top: Math.min(y(segment.start), y(segment.end)),
          height: Math.abs(y(segment.start) - y(segment.end)),
          runningY: y(segment.runningDifference),
        })),
      };
    }
    const families = (series ?? []).map((family, familyIndex) => ({
      id: family.id,
      label: family.label,
      sourceOnlyLabel: family.sourceOnlyLabel,
      color: family.color,
      dash: family.dash,
      lines: chartLines(
        points,
        stacks.map((segments) => y(segments[familyIndex].runningDifference)),
        monthCount,
      ),
    }));
    return {
      months,
      lines: chartLines(
        points,
        points.map((point) => y(point.running)),
        monthCount,
      ),
      zero: y("0"),
      families,
      ticks,
    };
  } catch {
    // Invalid, inconsistent or nonfinite family projections leave exact tables
    // usable. Call without series to retain the aggregate-only fallback chart.
    return null;
  }
}
