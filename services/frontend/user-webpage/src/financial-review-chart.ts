import type { CanonicalRow } from "./api/types.ts";
import { requireCalendarDate } from "./api/filters.ts";
import { sumExactDecimals } from "./decimal.ts";
import { chartLines, chartScale } from "./amount-trend-projection.ts";
import type { FinancialReviewFamilySeries } from "./financial-review-family-series.ts";

export interface ReviewFamilySegment {
  familyId: string;
  sourceGap: string;
  runningSourceGap: string;
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
  sourceGap: string;
  runningSourceGap: string;
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
  if (ids.size !== series.length) throw new Error("Chart repeats a type family");
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
      const sourceGap = exactAmount(familyPoint.sourceGap);
      const runningSourceGap = exactAmount(familyPoint.runningSourceGap);
      monthly = sumExactDecimals([monthly, sourceGap]) ?? "0";
      running = sumExactDecimals([running, runningSourceGap]) ?? "0";
      const isNegative = sourceGap.startsWith("-");
      const start = isNegative ? negative : positive;
      const end = sumExactDecimals([start, sourceGap]) ?? "0";
      if (isNegative) negative = end;
      else positive = end;
      return { familyId: family.id, sourceGap, runningSourceGap, start, end };
    });
    // Separate reads can briefly span different source revisions. Do not draw
    // colored components that disagree with the unchanged overview totals.
    if (monthly !== point.monthly || running !== point.running)
      throw new Error("Family chart totals differ from the overview");
    return segments;
  });
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
        segments.flatMap((segment) => [segment.start, segment.end, segment.runningSourceGap]),
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
          sourceGap: segment.sourceGap,
          runningSourceGap: segment.runningSourceGap,
          top: Math.min(y(segment.start), y(segment.end)),
          height: Math.abs(y(segment.start) - y(segment.end)),
          runningY: y(segment.runningSourceGap),
        })),
      };
    }
    const families = (series ?? []).map((family, familyIndex) => ({
      id: family.id,
      label: family.label,
      unpairedSource: family.unpairedSource,
      comparisonKind: family.comparisonKind,
      comparisonNote: family.comparisonNote,
      color: family.color,
      dash: family.dash,
      lines: chartLines(
        points.map((point) => point.monthIndex),
        stacks.map((segments) => y(segments[familyIndex].runningSourceGap)),
        monthCount,
      ),
    }));
    return {
      months,
      lines: chartLines(
        points.map((point) => point.monthIndex),
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
