import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import { isJsonObject } from "./validation.ts";

function requirePage(value: unknown, operation: string) {
  if (!isJsonObject(value) || !Array.isArray(value.rows) || value.rows.length > LOOKUP_PAGE_SIZE) {
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
    const page = requirePage(value, operation);
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
