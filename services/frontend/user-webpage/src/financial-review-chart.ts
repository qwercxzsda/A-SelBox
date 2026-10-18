import type { CanonicalRow } from "./api/types.ts";

interface ReviewChartPoint {
  row: CanonicalRow;
  monthlyY: number;
  runningY: number;
}

interface ReviewChart {
  months: (ReviewChartPoint | null)[];
  lines: string[];
  zero: number;
}

/** Approximate screen coordinates only; never use this projection for financial totals. */
export function projectFinancialReviewChart(rows: CanonicalRow[]): ReviewChart | null {
  const points = rows.map((row) => ({
    row,
    monthIndex: Number(row.month?.slice(5, 7)) - 1,
    monthly: row.difference === null ? NaN : Number(row.difference),
    running: row.running_difference === null ? NaN : Number(row.running_difference),
  }));
  if (
    points.length === 0 ||
    points.some(
      (point) =>
        !Number.isInteger(point.monthIndex) ||
        point.monthIndex < 0 ||
        point.monthIndex >= 12 ||
        !Number.isFinite(point.monthly) ||
        !Number.isFinite(point.running),
    )
  )
    return null;

  const magnitude = Math.max(
    1,
    ...points.flatMap(({ monthly, running }) => [Math.abs(monthly), Math.abs(running)]),
  );
  const values = points.flatMap(({ monthly, running }) => [
    monthly / magnitude,
    running / magnitude,
  ]);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const padding = (high - low || 1) * 0.12;
  const y = (value: number) =>
    ((high + padding - value / magnitude) / (high - low + padding * 2)) * 100;
  const monthCount = Math.max(...points.map(({ monthIndex }) => monthIndex)) + 1;
  const months: ReviewChart["months"] = Array.from({ length: monthCount }, () => null);
  const segments: string[][] = [];
  for (const [index, point] of points.entries()) {
    const runningY = y(point.running);
    months[point.monthIndex] = { row: point.row, monthlyY: y(point.monthly), runningY };
    if (index === 0 || points[index - 1].monthIndex !== point.monthIndex - 1) segments.push([]);
    segments[segments.length - 1].push(
      `${String(((point.monthIndex + 0.5) / monthCount) * 1000)},${String(runningY * 2)}`,
    );
  }
  return { months, lines: segments.map((segment) => segment.join(" ")), zero: y(0) };
}
