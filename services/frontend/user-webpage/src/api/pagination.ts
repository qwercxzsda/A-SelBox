import { parseTotalCount } from "./content-range.ts";
import { ApiError, readJson, type ApiTransport } from "./transport.ts";
import { parseObjectRows, requiredJsonString } from "./validation.ts";
import type { CanonicalRow } from "./types.ts";

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

/** Use the first exact count to avoid a terminal empty request. If the server omits
 * it, continue to an empty page. A short page alone never proves completion. */
async function collectLookupRows<T>(
  operation: string,
  identity: (row: T) => string,
  read: (offset: number, firstPage: boolean) => Promise<{ rows: T[]; totalCount: number | null }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  for (;;) {
    signal?.throwIfAborted();
    const page = await read(rows.length, rows.length === 0);
    signal?.throwIfAborted();
    if (page.rows.length > LOOKUP_PAGE_SIZE) throw new Error(`${operation} returned too many rows`);
    if (expected !== null && page.totalCount !== null && page.totalCount !== expected)
      throw new Error(`${operation} changed while loading. Please retry.`);
    expected ??= page.totalCount;
    for (const row of page.rows) {
      const key = identity(row);
      if (seen.has(key)) throw new Error(`${operation} did not advance to the next page`);
      seen.add(key);
      rows.push(row);
    }
    if (expected !== null && rows.length > expected)
      throw new Error(`${operation} returned an inconsistent record count`);
    if (rows.length === expected) return rows;
    if (!page.rows.length) {
      if (expected !== null) throw new Error(`${operation} returned an incomplete page`);
      return rows;
    }
  }
}

/** Collect complete factual rows, allowing smaller server pages without accepting duplicates. */
export async function readAllCsvRows<T>(
  transport: ApiTransport,
  options: {
    accessToken: string;
    endpoint: string;
    columns: readonly string[];
    order: string;
    operation: string;
    decode: (row: CanonicalRow) => T;
    identity: (row: T) => string;
    signal?: AbortSignal;
    filters?: Readonly<Record<string, string>>;
  },
): Promise<T[]> {
  const { accessToken, endpoint, columns, order, operation, decode, identity, signal, filters } =
    options;
  return collectLookupRows(
    operation,
    identity,
    async (offset, firstPage) => {
      const page = await transport.readCsvPage(
        accessToken,
        endpoint,
        new URLSearchParams({
          ...filters,
          select: columns.join(","),
          order,
          limit: String(LOOKUP_PAGE_SIZE),
          offset: String(offset),
        }),
        operation,
        signal,
        firstPage,
      );
      return { rows: page.rows.map(decode), totalCount: page.totalCount };
    },
    signal,
  );
}

/** Read complete PostgREST catalogs, allowing server page caps below the requested limit. */
export async function readAllJsonRows(
  transport: ApiTransport,
  accessToken: string,
  endpoint: string,
  select: string,
  order: string,
  operation: string,
): Promise<Record<string, unknown>[]> {
  return collectLookupRows(
    operation,
    (row: Record<string, unknown>) => requiredJsonString(row, "id"),
    async (offset, firstPage) => {
      const params = new URLSearchParams({
        select,
        order,
        limit: String(LOOKUP_PAGE_SIZE),
        offset: String(offset),
      });
      return transport.request(
        `/rest/v1/${endpoint}?${params.toString()}`,
        {
          headers: {
            ...transport.authenticatedHeaders(accessToken),
            ...(firstPage ? { Prefer: "count=exact" } : {}),
          },
        },
        operation,
        async (response, signal) => {
          const totalCount = parseTotalCount(response.headers.get("Content-Range"));
          if (response.status === 416 && totalCount !== null) return { rows: [], totalCount };
          if (!response.ok) throw new ApiError(operation, response.status);
          return {
            rows: parseObjectRows(await readJson(response, operation, signal), operation),
            totalCount,
          };
        },
      );
    },
  );
}
