import type { CurrencyTotal, TransactionTypeTotal } from "./types.ts";
import { isJsonObject } from "./validation.ts";

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

export function decodeCurrencyTotals(rows: unknown[]): CurrencyTotal[] {
  return rows.map((value) => {
    const row = requireTotalRow(value);
    if (row.component_type !== undefined && row.component_type !== null)
      throw new Error("Aggregation returned an invalid currency group");
    return decodeTotalFields(row);
  });
}

function decodeTotalFields(row: Record<string, unknown>): CurrencyTotal {
  const currency = row.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
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
    const type = row.component_type;
    if (typeof type !== "string" || !type.trim())
      throw new Error("Aggregation returned an invalid transaction type");
    const totals = decodeTotalFields(row);
    if (totals.currency !== currency)
      throw new Error("Aggregation returned an unexpected currency");
    return { type, ...totals };
  });
}
