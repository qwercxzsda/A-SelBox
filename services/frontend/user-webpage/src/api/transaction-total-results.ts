import { isJsonObject } from "./validation.ts";

export const MAX_TRANSACTION_TOTAL_GROUPS = 100_000;
export const TRANSACTION_TOTALS_LIMIT_MESSAGE =
  "This selection is too large. Choose a shorter date range or narrow your filters.";

/** A recoverable selection limit, never a reason to retry the same expensive query. */
export class TransactionTotalsLimitError extends Error {
  constructor() {
    super(TRANSACTION_TOTALS_LIMIT_MESSAGE);
    this.name = "TransactionTotalsLimitError";
  }
}

/** All aggregate groups come from one database snapshot; never accept a partial result. */
export function decodeTransactionTotalResult<Row>(
  value: unknown,
  decodeRows: (rows: unknown[]) => Row[],
  rowKey: (row: Row) => string,
  operation: string,
): Row[] {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value.rows) ||
    value.rows.length > MAX_TRANSACTION_TOTAL_GROUPS ||
    typeof value.group_count !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value.group_count) ||
    value.group_count !== String(value.rows.length)
  )
    throw new Error(`${operation} returned an invalid or incomplete aggregate`);

  const rows = decodeRows(value.rows);
  const groups = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (groups.has(key)) throw new Error(`${operation} returned a duplicate group`);
    groups.add(key);
  }
  return rows;
}
