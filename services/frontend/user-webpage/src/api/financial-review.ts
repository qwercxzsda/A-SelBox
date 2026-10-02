import { requireCalendarDate, textSelectionValues } from "./filters.ts";
import { DETAIL_PAGE_SIZE, LOOKUP_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow, PageResult } from "./types.ts";

export type FinancialReviewCategory = "SETTLEMENT" | "DATA_KIOSK" | "SELBOX";
export type FinancialReviewSource = "SETTLEMENT" | "DATA_KIOSK";

export interface FinancialReviewRecordFilters {
  source?: FinancialReviewSource;
  type?: string;
}

export interface FinancialReviewPageCursor {
  month: string;
  offset: number;
}

export interface FinancialReviewMonthPage {
  rows: CanonicalRow[];
  nextCursor: FinancialReviewPageCursor | null;
}

export const FINANCIAL_REVIEW_TOTAL_COLUMNS = [
  "month",
  "category",
  "currency",
  "settlement_amount",
  "data_kiosk_amount",
  "difference",
  "settlement_row_count",
  "data_kiosk_row_count",
] as const;

export const FINANCIAL_REVIEW_RECORD_COLUMNS = [
  "source",
  "source_row_id",
  "source_version_id",
  "activity_date",
  "seller_namespace",
  "marketplace_name",
  "sku",
  "component_type",
  "category",
  "currency",
  "amount",
] as const;

// The deployed PostgREST RPC CSV serializer alphabetizes headers independently of values.
// Matching projection order preserves field alignment on both affected and fixed servers.
function rpcProjection(columns: readonly string[]): string {
  return [...columns].sort().join(",");
}

export function requireFinancialReviewCategory(category: FinancialReviewCategory): void {
  if (!["SETTLEMENT", "DATA_KIOSK", "SELBOX"].includes(category))
    throw new Error("Choose a valid financial review category");
}

function requireMonth(month: string): void {
  requireCalendarDate(`${month}-01`);
}

function returnedMonth(date: string | null | undefined): string {
  if (!date) throw new Error("Financial review returned an invalid month");
  requireCalendarDate(date);
  if (!date.endsWith("-01")) throw new Error("Financial review returned an invalid month");
  return date.slice(0, 7);
}

function firstMonthInWindow(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = Math.max(0, (year - 1) * 12 + monthNumber - 1 - 5);
  return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function requireMonthPage(
  category: FinancialReviewCategory,
  cursor: FinancialReviewPageCursor | null,
  pageSize: number,
  filterMonth: string,
): void {
  requireFinancialReviewCategory(category);
  validatePagination(0, pageSize);
  // Leave room under the server's row cap for the next-page lookahead.
  validatePagination(0, pageSize + 1);
  if (typeof filterMonth !== "string") throw new Error("Choose a valid financial review month");
  if (filterMonth) requireMonth(filterMonth);
  if (cursor === null) return;
  if (typeof cursor !== "object" || Array.isArray(cursor))
    throw new Error("Choose a valid financial review page");
  requireMonth(cursor.month);
  validatePagination(cursor.offset, 1);
  if (!Number.isSafeInteger(cursor.offset + pageSize))
    throw new Error("Page offset exceeds JavaScript's safe range");
  if (filterMonth && cursor.month !== filterMonth)
    throw new Error("Financial review page does not match the selected month");
}

function scopeParams(category: FinancialReviewCategory): URLSearchParams {
  requireFinancialReviewCategory(category);
  return new URLSearchParams({ category: `eq.${category}` });
}

function followingMonthDate(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${String(year + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(monthNumber + 1).padStart(2, "0")}-01`;
}

function totalParams(
  category: FinancialReviewCategory,
  firstMonth: string,
  lastMonth = firstMonth,
): URLSearchParams {
  requireFinancialReviewCategory(category);
  requireMonth(firstMonth);
  requireMonth(lastMonth);
  return new URLSearchParams({
    p_category: category,
    p_month_from: `${firstMonth}-01`,
    p_month_to: followingMonthDate(lastMonth),
  });
}

function setDetailPage(params: URLSearchParams, currency: string, pageIndex: number): void {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
    throw new Error("A valid currency code is required");
  validatePagination(pageIndex, DETAIL_PAGE_SIZE);
  params.set("limit", String(DETAIL_PAGE_SIZE));
  params.set("offset", String(pageIndex * DETAIL_PAGE_SIZE));
}

export function createFinancialReviewApi(transport: ApiTransport) {
  async function readLatestMonth(
    accessToken: string,
    category: FinancialReviewCategory,
    before?: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const params = scopeParams(category);
    params.set("select", "activity_date");
    params.set("order", "activity_date.desc");
    params.set("limit", "1");
    if (before) params.set("activity_date", `lt.${before}-01`);
    const result = await transport.readCsvPage(
      accessToken,
      "financial_review_records",
      params,
      "Latest financial review month",
      signal,
      false,
    );
    if (result.rows.length === 0) return null;
    const date = result.rows[0].activity_date;
    if (!date) throw new Error("Financial review returned an invalid activity date");
    requireCalendarDate(date);
    const month = date.slice(0, 7);
    if (before && month >= before)
      throw new Error("Financial review returned a month outside the requested range");
    return month;
  }

  return {
    async fetchFinancialReviewMonths(
      accessToken: string,
      category: FinancialReviewCategory,
      cursor: FinancialReviewPageCursor | null,
      pageSize: number,
      filterMonth: string,
      signal?: AbortSignal,
    ): Promise<FinancialReviewMonthPage> {
      requireMonthPage(category, cursor, pageSize, filterMonth);
      let month =
        cursor?.month ??
        (filterMonth || (await readLatestMonth(accessToken, category, undefined, signal)));
      let offset = cursor?.offset ?? 0;
      const rows: CanonicalRow[] = [];
      while (month !== null) {
        const firstMonth = filterMonth || firstMonthInWindow(month);
        const remaining = pageSize - rows.length;
        const params = totalParams(category, firstMonth, month);
        params.set("select", rpcProjection(FINANCIAL_REVIEW_TOTAL_COLUMNS));
        params.set("order", "month.desc,currency.asc");
        params.set("limit", String(remaining + 1));
        params.set("offset", String(offset));
        const result = await transport.readCsvPage(
          accessToken,
          "rpc/financial_review_totals",
          params,
          "Monthly financial review",
          signal,
          false,
        );
        if (result.rows.length > remaining + 1)
          throw new Error("Financial review returned too many monthly currencies");
        for (const row of result.rows) {
          const rowMonth = returnedMonth(row.month);
          if (rowMonth < firstMonth || rowMonth > month)
            throw new Error("Financial review returned a month outside the requested range");
        }
        rows.push(...result.rows.slice(0, remaining));
        if (result.rows.length > remaining)
          return { rows, nextCursor: { month, offset: offset + remaining } };
        if (filterMonth) return { rows, nextCursor: null };
        month = await readLatestMonth(accessToken, category, firstMonth, signal);
        offset = 0;
        if (month !== null && rows.length === pageSize)
          return { rows, nextCursor: { month, offset } };
      }
      return { rows, nextCursor: null };
    },
    async fetchFinancialReviewTotals(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      signal?: AbortSignal,
    ): Promise<CanonicalRow[]> {
      const params = totalParams(category, month);
      params.set("select", rpcProjection(FINANCIAL_REVIEW_TOTAL_COLUMNS));
      params.set("order", "currency.asc");
      params.set("limit", String(LOOKUP_PAGE_SIZE));
      const result = await transport.readCsvPage(
        accessToken,
        "rpc/financial_review_totals",
        params,
        "Financial review totals",
        signal,
        false,
      );
      if (result.rows.length >= LOOKUP_PAGE_SIZE)
        throw new Error("Financial review returned too many currencies");
      return result.rows;
    },
    fetchFinancialReviewTypes(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<PageResult> {
      const params = totalParams(category, month);
      setDetailPage(params, currency, pageIndex);
      params.set("p_currency", currency);
      params.set(
        "select",
        rpcProjection([
          "month",
          "category",
          "currency",
          "source",
          "component_type",
          "amount",
          "row_count",
        ]),
      );
      params.set("order", "source.asc,component_type.asc");
      return transport.readCsvPage(
        accessToken,
        "rpc/financial_review_type_totals",
        params,
        "Financial review amounts by type",
        signal,
      );
    },
    fetchFinancialReviewRecords(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      pageIndex: number,
      filters: FinancialReviewRecordFilters = {},
      signal?: AbortSignal,
    ): Promise<PageResult> {
      const params = scopeParams(category);
      requireMonth(month);
      setDetailPage(params, currency, pageIndex);
      params.set("currency", `eq.${currency}`);
      const types = textSelectionValues(
        "component_type",
        filters.type === undefined ? [] : [filters.type],
      );
      if (filters.source !== undefined) {
        if (!["SETTLEMENT", "DATA_KIOSK"].includes(filters.source))
          throw new Error("Choose a valid financial review source");
        params.set("source", `eq.${filters.source}`);
      }
      if (types.length > 0) params.set("component_type", `eq.${types[0]}`);
      const monthEnd = new Date(`${month}-01T00:00:00Z`);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      monthEnd.setUTCDate(0);
      params.set(
        "and",
        `(activity_date.gte.${month}-01,activity_date.lte.${month}-${String(monthEnd.getUTCDate())})`,
      );
      params.set("select", FINANCIAL_REVIEW_RECORD_COLUMNS.join(","));
      params.set("order", "activity_date.desc,source.asc,source_row_id.asc");
      return transport.readCsvPage(
        accessToken,
        "financial_review_records",
        params,
        "Financial review source records",
        signal,
      );
    },
  };
}
