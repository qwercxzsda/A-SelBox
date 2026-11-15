import { requireCalendarDate } from "./api/filters.ts";
import { chartLines, chartScale } from "./amount-trend-projection.ts";
import { compareDecimals, sumExactDecimals } from "./decimal.ts";
import { differenceExact } from "./source-diagnostics.ts";
import { transactionTypeGroup } from "./transaction-type-family-catalog.ts";
import { TRANSACTION_TYPE_GROUPS, type TypeGroupId } from "./transaction-type-families.ts";
import type { CurrencyTotal, TransactionTrendGranularity } from "./api/types.ts";
import type { DateRange } from "./summary-periods.ts";
import { summaryDateLabel } from "./summary-date-label.ts";
import type { FINANCIAL_AMOUNTS } from "./financial-amounts.ts";

type TrendAmountField = (typeof FINANCIAL_AMOUNTS)[number][0];
type TransactionTrendValues = Pick<
  CurrencyTotal,
  TrendAmountField | "rowCount" | "missingFeeCount"
>;

export interface TransactionTrendAmount extends TransactionTrendValues {
  periodStart: string;
  type: string;
}

export type { TransactionTrendGranularity } from "./api/types.ts";

interface TrendGroupAmount extends TransactionTrendValues {
  id: TypeGroupId;
}

export interface TransactionTrendPoint extends TransactionTrendValues {
  periodStart: string;
  from: string;
  to: string;
  groups: TrendGroupAmount[];
}

function sumTrendValues(rows: readonly TransactionTrendAmount[]): TransactionTrendValues {
  const sum = (field: TrendAmountField) =>
    rows.length ? sumExactDecimals(rows.map((row) => row[field])) : "0";
  return {
    reportedAmount: sum("reportedAmount"),
    serviceFee: sum("serviceFee"),
    companyAmount: sum("companyAmount"),
    rowCount: rows.reduce((total, row) => total + row.rowCount, 0),
    missingFeeCount: rows.reduce((total, row) => total + row.missingFeeCount, 0),
  };
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodStart(value: string, granularity: TransactionTrendGranularity): string {
  if (granularity === "day") return value;
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return shiftDate(value, -((day + 6) % 7));
}

/** All sums remain exact; a missing amount is never zero-filled as a known transaction. */
export function transactionTrendPoints(
  rows: readonly TransactionTrendAmount[],
  granularity: TransactionTrendGranularity,
  range: DateRange,
): TransactionTrendPoint[] {
  const dates = rows.map((row) => row.periodStart).sort();
  const from = range.from || dates[0];
  const latest = dates.at(-1);
  const to = range.to || (latest ? shiftDate(latest, granularity === "week" ? 6 : 0) : undefined);
  if (!from || !to) return [];
  requireCalendarDate(from);
  requireCalendarDate(to);
  if (from > to) return [];
  const first = periodStart(from, granularity);
  const step = granularity === "day" ? 1 : 7;
  const duration =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86_400_000;
  const periodCount = Math.floor(duration / step) + 1;
  if (periodCount > 5000)
    throw new Error("Select a shorter date range to display trends (up to 5,000 periods).");
  const groups = new Set(rows.map((row) => transactionTypeGroup(row.type).id));
  const groupIds = TRANSACTION_TYPE_GROUPS.filter((group) => groups.has(group.id)).map(
    (group) => group.id,
  );
  const byPeriod = new Map<string, TransactionTrendAmount[]>();
  for (const row of rows) {
    requireCalendarDate(row.periodStart);
    if (periodStart(row.periodStart, granularity) !== row.periodStart)
      throw new Error("Transaction trend bucket does not match the selected granularity");
    if (row.periodStart < first || row.periodStart > to)
      throw new Error("Transaction trend bucket is outside the selected range");
    const period = byPeriod.get(row.periodStart) ?? [];
    period.push(row);
    byPeriod.set(row.periodStart, period);
  }
  const points: TransactionTrendPoint[] = [];
  for (let index = 0; index < periodCount; index++) {
    const start = shiftDate(first, index * step);
    const periodRows = byPeriod.get(start) ?? [];
    const end = shiftDate(start, step - 1);
    points.push({
      periodStart: start,
      from: start < from ? from : start,
      to: end > to ? to : end,
      ...sumTrendValues(periodRows),
      groups: groupIds.map((id) => {
        const matching = periodRows.filter((row) => transactionTypeGroup(row.type).id === id);
        return {
          id,
          ...sumTrendValues(matching),
        };
      }),
    });
  }
  return points;
}

const GROUP_VISUALS: Record<TypeGroupId, string> = {
  sales: "#2563eb",
  selling: "#d97706",
  fulfillment: "#7c3aed",
  inventory: "#0f766e",
  advertising: "#be185d",
  taxes: "#92400e",
  other: "#475569",
  "seller-costs": "#15803d",
};

interface GroupContribution {
  part: "reported" | "serviceFee";
  amount: string;
}

/** Split only known company amounts; unresolved reported rows do not inflate the chart. */
function groupContributions(group: TrendGroupAmount): GroupContribution[] {
  if (group.companyAmount === null) return [];
  if (group.serviceFee === null || compareDecimals(group.serviceFee, "0") === 0)
    return [{ part: "reported", amount: group.companyAmount }];
  const reported = differenceExact(group.companyAmount, group.serviceFee);
  if (reported === null) throw new Error("Known trend contributions require exact amounts");
  return [
    { part: "reported", amount: reported },
    { part: "serviceFee", amount: group.serviceFee },
  ];
}

/** Signed reported/fee contributions sum to each period's company total, never a running total. */
export function projectTransactionTrend(points: readonly TransactionTrendPoint[]) {
  if (!points.length) return null;
  try {
    const stacks = points.map((point) => {
      let positive = "0";
      let negative = "0";
      return point.groups.flatMap((group) =>
        groupContributions(group).map(({ part, amount }) => {
          const start = amount.startsWith("-") ? negative : positive;
          const end = sumExactDecimals([start, amount]) ?? "0";
          if (amount.startsWith("-")) negative = end;
          else positive = end;
          return { ...group, part, amount, start, end };
        }),
      );
    });
    const known = points.flatMap((point, index) =>
      point.companyAmount === null ? [] : [{ index, amount: point.companyAmount }],
    );
    const { y, ticks } = chartScale([
      ...known.map((point) => point.amount),
      ...stacks.flatMap((groups) => groups.flatMap((group) => [group.start, group.end])),
    ]);
    return {
      zero: y("0"),
      ticks,
      groups: points[0].groups.map(({ id }) => ({
        id,
        label: TRANSACTION_TYPE_GROUPS.find((group) => group.id === id)?.label ?? id,
        color: GROUP_VISUALS[id],
        dash: "",
        lines: [] as string[],
      })),
      lines: chartLines(
        known.map((point) => point.index),
        known.map((point) => y(point.amount)),
        points.length,
      ),
      points: points.map((point, index) => ({
        ...point,
        amount: point.companyAmount,
        lineY: point.companyAmount === null ? null : y(point.companyAmount),
        segments: stacks[index].map((group) => ({
          id: `${group.id}:${group.part}`,
          familyId: group.id,
          part: group.part,
          amount: group.amount,
          missingFeeCount: group.missingFeeCount,
          top: Math.min(y(group.start), y(group.end)),
          height: Math.abs(y(group.start) - y(group.end)),
          lineY: null,
        })),
      })),
    };
  } catch {
    return null;
  }
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const shortFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function transactionTrendDateLabel(
  point: Pick<TransactionTrendPoint, "from" | "to">,
): string {
  const from = dateFormatter.format(new Date(`${point.from}T00:00:00Z`));
  return point.from === point.to
    ? from
    : `${from} – ${dateFormatter.format(new Date(`${point.to}T00:00:00Z`))}`;
}

export function compactTransactionTrendDateLabel(
  point: Pick<TransactionTrendPoint, "from" | "to">,
): string {
  return summaryDateLabel(point);
}

export function transactionTrendShortLabel(date: string): string {
  return shortFormatter.format(new Date(`${date}T00:00:00Z`));
}
