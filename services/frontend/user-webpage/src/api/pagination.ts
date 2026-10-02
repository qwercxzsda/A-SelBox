import { parseTotalCount } from "./content-range.ts";
import { ApiError, readJson, type ApiTransport } from "./transport.ts";
import { parseObjectRows, requiredJsonString } from "./validation.ts";

export const LOOKUP_PAGE_SIZE = 1000;
export const DETAIL_PAGE_SIZE = 50;

export function validatePagination(pageIndex: number, pageSize: number): void {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("Page index must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > LOOKUP_PAGE_SIZE) {
    throw new Error("Page size must be a positive integer of at most 1000");
  }
  if (!Number.isSafeInteger(pageIndex * pageSize)) {
    throw new Error("Page offset exceeds JavaScript's safe range");
  }
}

interface LookupPage<Row> {
  rows: Row[];
  totalCount: number | null;
}

async function readEveryPage<Row>(
  readPage: (offset: number, includeCount: boolean) => Promise<LookupPage<Row>>,
  rowKey: (row: Row) => string,
  operation: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  for (;;) {
    const page = await readPage(rows.length, expectedCount === null);
    if (expectedCount !== null && page.totalCount !== null && page.totalCount !== expectedCount) {
      throw new Error(`${operation} changed while loading. Please retry.`);
    }
    expectedCount ??= page.totalCount;
    for (const row of page.rows) {
      const key = rowKey(row);
      if (seen.has(key)) throw new Error(`${operation} did not advance to the next page`);
      seen.add(key);
      rows.push(row);
    }
    if (expectedCount !== null && rows.length > expectedCount) {
      throw new Error(`${operation} returned an inconsistent record count`);
    }
    if (rows.length === expectedCount) return rows;
    if (page.rows.length === 0) {
      if (expectedCount !== null) throw new Error(`${operation} returned an incomplete page`);
      return rows;
    }
  }
}

export function readAllJsonRows(
  transport: ApiTransport,
  accessToken: string,
  endpoint: string,
  select: string,
  order: string,
  operation: string,
): Promise<Record<string, unknown>[]> {
  return readEveryPage(
    async (offset, includeCount) => {
      const params = new URLSearchParams({
        select,
        order,
        limit: String(LOOKUP_PAGE_SIZE),
        offset: String(offset),
      });
      const response = await transport.request(
        `/rest/v1/${endpoint}?${params.toString()}`,
        {
          headers: {
            ...transport.authenticatedHeaders(accessToken),
            ...(includeCount ? { Prefer: "count=exact" } : {}),
          },
        },
        operation,
      );
      const totalCount = parseTotalCount(response.headers.get("Content-Range"));
      if (response.status === 416 && totalCount !== null) return { rows: [], totalCount };
      if (!response.ok) throw new ApiError(operation, response.status);
      return { rows: parseObjectRows(await readJson(response, operation), operation), totalCount };
    },
    (row) => requiredJsonString(row, "id"),
    operation,
  );
}
