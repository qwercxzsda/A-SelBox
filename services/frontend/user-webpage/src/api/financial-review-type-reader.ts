import { sumExactDecimals } from "../decimal.ts";
import { parseExactCount } from "./content-range.ts";
import { requireCalendarDate, textSelectionValues } from "./filters.ts";
import type { FinancialReviewCategory } from "./financial-review.ts";
import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { isJsonObject } from "./validation.ts";
import type { SourceTotals } from "./source-totals.ts";

export interface SourceTypeTotals {
  rows: CanonicalRow[];
  revision: NonNullable<SourceTotals["revision"]>;
}

async function readSourceRevision(
  transport: ApiTransport,
  accessToken: string,
  signal?: AbortSignal,
): Promise<SourceTypeTotals["revision"]> {
  const value = await transport.requestJson(
    "/rest/v1/rpc/workspace_revisions?p_sources=%7Bfinances%2Cdata_kiosk%7D",
    {
      signal,
      cache: "no-store",
      headers: transport.authenticatedHeaders(accessToken),
    },
    "Source comparison revision",
  );
  if (
    !isJsonObject(value) ||
    !isJsonObject(value.revisions) ||
    typeof value.revisions.finances !== "string" ||
    !value.revisions.finances ||
    typeof value.revisions.data_kiosk !== "string" ||
    !value.revisions.data_kiosk
  )
    throw new Error("Source comparison returned invalid revisions");
  return { finances: value.revisions.finances, data_kiosk: value.revisions.data_kiosk };
}

const MAX_TYPE_GROUPS = 50_000;
const MAX_TYPE_PAGES = 200;
const OPERATION = "Financial review type totals";

export interface FinancialReviewTypeScope {
  category: FinancialReviewCategory;
  firstMonth: string;
  lastMonth: string;
  currency: string;
  marketplace: string;
}

function requireTypeGroup(row: CanonicalRow, scope: FinancialReviewTypeScope): string {
  const month = row.month;
  if (typeof month !== "string") throw new Error(`${OPERATION} returned an invalid month`);
  requireCalendarDate(month);
  if (
    !month.endsWith("-01") ||
    month < `${scope.firstMonth}-01` ||
    month > `${scope.lastMonth}-01` ||
    row.category !== scope.category ||
    row.marketplace_name !== scope.marketplace ||
    row.currency !== scope.currency
  )
    throw new Error(`${OPERATION} returned a different scope`);
  if (row.source !== "FINANCES" && row.source !== "DATA_KIOSK")
    throw new Error(`${OPERATION} returned an invalid source`);
  if (typeof row.component_type !== "string")
    throw new Error(`${OPERATION} returned an invalid type`);
  textSelectionValues("component_type", [row.component_type]);
  if (typeof row.amount !== "string" || sumExactDecimals([row.amount]) === null)
    throw new Error(`${OPERATION} returned an invalid amount`);
  if (parseExactCount(row.row_count) === 0)
    throw new Error(`${OPERATION} returned an empty type group`);
  return JSON.stringify([month, row.source, row.component_type]);
}

/** Complete aggregate reads must never turn a server page cap into a partial total. */
export async function readCompleteFinancialReviewTypes(
  transport: ApiTransport,
  accessToken: string,
  params: URLSearchParams,
  scope: FinancialReviewTypeScope,
  signal?: AbortSignal,
): Promise<SourceTypeTotals> {
  const revision = await readSourceRevision(transport, accessToken, signal);
  const rows: CanonicalRow[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  params.set("order", "month.asc,source.asc,component_type.asc");
  params.set("limit", String(LOOKUP_PAGE_SIZE));
  for (let pageIndex = 0; pageIndex < MAX_TYPE_PAGES; pageIndex++) {
    signal?.throwIfAborted();
    params.set("offset", String(rows.length));
    const page = await transport.readCsvPage(
      accessToken,
      "rpc/financial_review_type_totals",
      params,
      OPERATION,
      signal,
    );
    signal?.throwIfAborted();
    if (page.totalCount === null || page.rows.length > LOOKUP_PAGE_SIZE)
      throw new Error(`${OPERATION} returned an incomplete page count`);
    if (page.totalCount > MAX_TYPE_GROUPS)
      throw new Error(`${OPERATION} exceeds the complete comparison limit`);
    if (expectedCount !== null && page.totalCount !== expectedCount)
      throw new Error(`${OPERATION} changed while loading. Please retry.`);
    expectedCount = page.totalCount;
    for (const row of page.rows) {
      const key = requireTypeGroup(row, scope);
      if (seen.has(key)) throw new Error(`${OPERATION} repeated a type group. Please retry.`);
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > expectedCount) throw new Error(`${OPERATION} returned an inconsistent count`);
    if (rows.length === expectedCount) {
      const after = await readSourceRevision(transport, accessToken, signal);
      if (revision.finances !== after.finances || revision.data_kiosk !== after.data_kiosk)
        throw new Error(`${OPERATION} changed while loading. Please retry.`);
      return { rows, revision };
    }
    if (page.rows.length === 0)
      throw new Error(`${OPERATION} returned an incomplete comparison. Please retry.`);
  }
  throw new Error(`${OPERATION} exceeds the complete comparison page limit`);
}
