import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import { isJsonObject } from "./validation.ts";

function requirePage(value: unknown, field: string, operation: string) {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value[field]) ||
    value[field].length > LOOKUP_PAGE_SIZE
  ) {
    throw new Error(`${operation} returned an invalid page`);
  }
  return value;
}

/** RPC envelopes describe the next page explicitly, without a separate exact count. */
export async function readOffsetRpcRows<Row>(
  readPage: (offset: number) => Promise<unknown>,
  decodeRows: (rows: unknown[]) => Row[],
  rowKey: (row: Row) => string,
  operation: string,
  signal?: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const value = await readPage(offset);
    signal?.throwIfAborted();
    const page = requirePage(value, "rows", operation);
    const batch = decodeRows(page.rows as unknown[]);
    if (offset > 0 && batch.length === 0)
      throw new Error(`${operation} returned an incomplete page. Please retry.`);
    const next = page.next_offset;
    if (
      next !== null &&
      (typeof next !== "number" ||
        !Number.isSafeInteger(next) ||
        next !== offset + batch.length ||
        next <= offset)
    ) {
      throw new Error(`${operation} returned an invalid next offset`);
    }
    for (const row of batch) {
      const key = rowKey(row);
      if (seen.has(key)) throw new Error(`${operation} returned a duplicate group`);
      seen.add(key);
      rows.push(row);
    }
    if (next === null) return rows;
    offset = next;
  }
}

/** Preserve the database's C collation order; JavaScript string ordering differs for Unicode. */
export async function readCursorRpcValues(
  readPage: (after: string | null) => Promise<unknown>,
  operation: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const values: string[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (;;) {
    signal?.throwIfAborted();
    const value = await readPage(after);
    signal?.throwIfAborted();
    const page = requirePage(value, "values", operation);
    const batch = page.values as unknown[];
    if (after !== null && batch.length === 0)
      throw new Error(`${operation} returned an incomplete page. Please retry.`);
    const next = page.next_cursor;
    if (
      next !== null &&
      (typeof next !== "string" || next !== batch.at(-1) || next === after || seen.has(next))
    ) {
      throw new Error(`${operation} returned an invalid next cursor`);
    }
    for (const entry of batch) {
      if (typeof entry !== "string") throw new Error(`${operation} returned an invalid value`);
      if (seen.has(entry)) throw new Error(`${operation} returned a duplicate value`);
      seen.add(entry);
      values.push(entry);
    }
    if (next === null) return values;
    after = next;
  }
}
