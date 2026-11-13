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
  const rows: T[] = [];
  const seen = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    const page = await transport.readCsvPage(
      accessToken,
      endpoint,
      new URLSearchParams({
        ...filters,
        select: columns.join(","),
        order,
        limit: String(LOOKUP_PAGE_SIZE),
        offset: String(rows.length),
      }),
      operation,
      signal,
      false,
    );
    signal?.throwIfAborted();
    if (page.rows.length === 0) return rows;
    if (page.rows.length > LOOKUP_PAGE_SIZE) throw new Error(`${operation} returned too many rows`);
    for (const value of page.rows) {
      const row = decode(value);
      const key = identity(row);
      if (seen.has(key)) throw new Error(`${operation} did not advance to the next page`);
      seen.add(key);
      rows.push(row);
    }
  }
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
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  for (;;) {
    const params = new URLSearchParams({
      select,
      order,
      limit: String(LOOKUP_PAGE_SIZE),
      offset: String(rows.length),
    });
    const page: { rows: Record<string, unknown>[]; totalCount: number | null } =
      await transport.request(
        `/rest/v1/${endpoint}?${params.toString()}`,
        {
          headers: {
            ...transport.authenticatedHeaders(accessToken),
            ...(expectedCount === null ? { Prefer: "count=exact" } : {}),
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
    if (expectedCount !== null && page.totalCount !== null && page.totalCount !== expectedCount)
      throw new Error(`${operation} changed while loading. Please retry.`);
    expectedCount ??= page.totalCount;
    for (const row of page.rows) {
      const key = requiredJsonString(row, "id");
      if (seen.has(key)) throw new Error(`${operation} did not advance to the next page`);
      seen.add(key);
      rows.push(row);
    }
    if (expectedCount !== null && rows.length > expectedCount)
      throw new Error(`${operation} returned an inconsistent record count`);
    if (rows.length === expectedCount) return rows;
    if (page.rows.length === 0) {
      if (expectedCount !== null) throw new Error(`${operation} returned an incomplete page`);
      return rows;
    }
  }
}
