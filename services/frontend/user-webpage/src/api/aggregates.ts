import type {
  CurrencyTotal,
  MarketplaceCurrencyTotal,
  TransactionTypeTotal,
  TransactionTrendTotal,
  TransactionTrendGranularity,
} from "./types.ts";
import { isCurrency, isJsonObject } from "./validation.ts";
import { requireCalendarDate } from "./filters.ts";

function aggregateCount(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Aggregation returned an invalid record count");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error("Aggregation record count is too large");
  return count;
}

function aggregateAmount(row: Record<string, unknown>, key: string): string | null {
  if (!Object.hasOwn(row, key)) throw new Error("Aggregation returned incomplete amounts");
  const value = row[key];
  if (
    value !== null &&
    (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
  ) {
    throw new Error("Aggregation returned an invalid amount");
  }
  return value;
}

function requireTotalRow(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) throw new Error("Aggregation returned an invalid row");
  return value;
}

function aggregateMarketplace(row: Record<string, unknown>): string {
  const value = row.marketplace_name;
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error("Aggregation returned an invalid marketplace");
  return value;
}

function aggregateType(row: Record<string, unknown>): string {
  const value = row.component_type;
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error("Aggregation returned an invalid transaction type");
  return value;
}

export function decodeMarketplaceCurrencyTotals(rows: unknown[]): MarketplaceCurrencyTotal[] {
  return rows.map((value) => {
    const row = requireTotalRow(value);
    if (row.component_type !== undefined && row.component_type !== null)
      throw new Error("Aggregation returned an invalid marketplace currency group");
    return { marketplace: aggregateMarketplace(row), ...decodeTotalFields(row) };
  });
}

function decodeTotalFields(row: Record<string, unknown>): CurrencyTotal {
  const currency = row.currency;
  if (!isCurrency(currency)) {
    throw new Error("Aggregation returned an invalid currency");
  }
  const rowCount = aggregateCount(row, "row_count");
  const knownCount = aggregateCount(row, "known_company_count");
  if (rowCount === 0) throw new Error("Aggregation returned an empty group");
  if (knownCount > rowCount) throw new Error("Aggregation returned inconsistent record counts");
  return {
    currency,
    reportedAmount: aggregateAmount(row, "reported_amount"),
    serviceFee: aggregateAmount(row, "service_fee"),
    companyAmount: aggregateAmount(row, "company_amount"),
    rowCount,
    missingFeeCount: rowCount - knownCount,
  };
}

export function decodeTypeTotals(rows: unknown[], currency: string): TransactionTypeTotal[] {
  return rows.map((value) => {
    const row = requireTotalRow(value);
    const type = aggregateType(row);
    const totals = decodeTotalFields(row);
    if (totals.currency !== currency)
      throw new Error("Aggregation returned an unexpected currency");
    return { type, ...totals };
  });
}

export function decodeTransactionTrends(
  rows: unknown[],
  granularity: TransactionTrendGranularity,
): TransactionTrendTotal[] {
  return rows.map((value) => {
    const row = requireTotalRow(value);
    const periodStart = row.period_start;
    if (typeof periodStart !== "string") throw new Error("Trends returned an invalid period");
    requireCalendarDate(periodStart);
    if (granularity === "week" && new Date(`${periodStart}T00:00:00Z`).getUTCDay() !== 1)
      throw new Error("Trends returned a week that does not start on Monday");
    const marketplace = aggregateMarketplace(row);
    const type = aggregateType(row);
    const total = decodeTotalFields(row);
    if ((total.companyAmount === null) !== (total.missingFeeCount === total.rowCount))
      throw new Error("Trends returned inconsistent company amounts");
    return { periodStart, marketplace, type, ...total };
  });
}
