import type { SourceCategory, SourceName, SourceTotals } from "./api/source-totals.ts";
import type { CanonicalRow } from "./api/types.ts";
import { sumExactDecimals } from "./decimal.ts";

export type ReportDiagnosticScope = SourceTotals["scope"] & { report_id: string };

export function requireReportDiagnosticScope(
  result: SourceTotals,
  expected: ReportDiagnosticScope,
): void {
  for (const key of [
    "report_id",
    "start_date",
    "end_date",
    "marketplace_name",
    "currency",
  ] as const) {
    if (result.scope[key] !== expected[key])
      throw new Error("Source totals returned a different saved report scope");
  }
}

export function sameSourceRevision(
  left: Pick<SourceTotals, "revision"> | undefined,
  right: Pick<SourceTotals, "revision"> | undefined,
): boolean {
  const a = left?.revision;
  const b = right?.revision;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return a.finances === b.finances && a.data_kiosk === b.data_kiosk;
}

export function differenceExact(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  const normalized = sumExactDecimals([right]);
  if (normalized === null) return null;
  return sumExactDecimals([
    left,
    normalized.startsWith("-") ? normalized.slice(1) : `-${normalized}`,
  ]);
}

/** Unknown values cannot silently become a partial headline or running total. */
export function sumCompleteDecimals(values: readonly (string | null)[]): string | null {
  return values.some((value) => value === null) ? null : sumExactDecimals(values);
}

export function monthSourcePeriod(month: string): { startDate: string; endDate: string } {
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { startDate: `${month}-01`, endDate: end.toISOString().slice(0, 10) };
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function periodBounds(result: SourceTotals, period: string | null): [string, string] {
  if (period === null) return [result.scope.start_date, result.scope.end_date];
  if (result.grouping === "day") return [period, period];
  const end = monthSourcePeriod(period.slice(0, 7)).endDate;
  return [
    period < result.scope.start_date ? result.scope.start_date : period,
    end > result.scope.end_date ? result.scope.end_date : end,
  ];
}

export function hasCompleteCoverage(
  result: SourceTotals,
  source: SourceName,
  period: string | null,
  seller: string | null,
): boolean {
  const [start, end] = periodBounds(result, period);
  const relevant = result.coverage.filter(
    (item) => item.start_date <= end && item.end_date >= start,
  );
  const sellers =
    seller === null ? [...new Set(relevant.map((item) => item.seller_namespace))] : [seller];
  if (!sellers.length) return false;
  return sellers.every((identity) => {
    let coveredThrough = start;
    for (const item of relevant
      .filter((item) => item.source === source && item.seller_namespace === identity)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))) {
      if (item.start_date > coveredThrough) return false;
      if (item.end_date >= end) return true;
      if (item.end_date >= coveredThrough) coveredThrough = nextDate(item.end_date);
    }
    return false;
  });
}

/** Pivot native values in one scope; retrieval evidence alone authorizes an absent side's zero. */
export function buildSourceComparisons(
  result: SourceTotals,
  category: SourceCategory,
): CanonicalRow[] {
  type Anchor = Pick<
    SourceTotals["rows"][number],
    "seller_namespace" | "period" | "marketplace_name" | "currency"
  >;
  const groups = new Map<string, { anchor: Anchor; rows: typeof result.rows }>();
  const keyFor = (row: Anchor) =>
    JSON.stringify([row.seller_namespace, row.period, row.marketplace_name, row.currency]);
  for (const row of result.rows) {
    const key = keyFor(row);
    const group = groups.get(key) ?? { anchor: row, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  if (result.grouping !== "day" && result.scope.currency !== null) {
    const periods: (string | null)[] = [];
    if (result.grouping === "total") periods.push(null);
    else {
      let month = `${result.scope.start_date.slice(0, 7)}-01`;
      while (month <= result.scope.end_date) {
        periods.push(month);
        month = nextDate(monthSourcePeriod(month.slice(0, 7)).endDate);
      }
    }
    for (const period of periods) {
      const anchor = {
        seller_namespace: null,
        period,
        marketplace_name: result.scope.marketplace_name,
        currency: result.scope.currency,
      };
      const key = keyFor(anchor);
      const [start, end] = periodBounds(result, period);
      if (
        !groups.has(key) &&
        result.coverage.some((item) => item.start_date <= end && item.end_date >= start)
      )
        groups.set(key, { anchor, rows: [] });
    }
  }
  return [...groups.values()].map(({ anchor, rows }) => {
    const values = (source: SourceName) => {
      const selected = rows.filter((row) => row.source === source && row.category === category);
      const covered = hasCompleteCoverage(result, source, anchor.period, anchor.seller_namespace);
      return {
        amount: selected.length
          ? sumExactDecimals(selected.map((row) => row.amount))
          : covered
            ? "0"
            : null,
        count: selected.length
          ? selected.reduce((sum, row) => sum + BigInt(row.row_count), 0n).toString()
          : covered
            ? "0"
            : null,
        covered,
      };
    };
    const finances = values("FINANCES");
    const kiosk = values("DATA_KIOSK");
    return {
      seller_namespace: anchor.seller_namespace,
      month: anchor.period,
      activity_date: anchor.period,
      marketplace_name: anchor.marketplace_name,
      currency: anchor.currency,
      category,
      finances_amount: finances.amount,
      data_kiosk_amount: kiosk.amount,
      difference: differenceExact(finances.amount, kiosk.amount),
      finances_row_count: finances.count,
      data_kiosk_row_count: kiosk.count,
      finances_covered: String(finances.covered),
      data_kiosk_covered: String(kiosk.covered),
    };
  });
}

/** Apply the same missing-data rules to a type-family projection of the native type totals. */
export function applyComparisonCoverage(
  rows: readonly CanonicalRow[],
  result: SourceTotals,
): CanonicalRow[] {
  return rows.map((row) => {
    const financesCovered = hasCompleteCoverage(result, "FINANCES", row.month ?? null, null);
    const kioskCovered = hasCompleteCoverage(result, "DATA_KIOSK", row.month ?? null, null);
    const finances =
      row.finances_row_count === "0" && !financesCovered ? null : row.finances_amount;
    const kiosk = row.data_kiosk_row_count === "0" && !kioskCovered ? null : row.data_kiosk_amount;
    return {
      ...row,
      finances_amount: finances,
      data_kiosk_amount: kiosk,
      finances_row_count: finances === null ? null : row.finances_row_count,
      data_kiosk_row_count: kiosk === null ? null : row.data_kiosk_row_count,
      finances_covered: String(financesCovered),
      data_kiosk_covered: String(kioskCovered),
      difference: differenceExact(finances, kiosk),
    };
  });
}
