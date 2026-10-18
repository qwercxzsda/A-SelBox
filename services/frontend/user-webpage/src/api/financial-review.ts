import { requireCalendarDate, textSelectionValues } from "./filters.ts";
import { DETAIL_PAGE_SIZE, LOOKUP_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow, PageResult } from "./types.ts";
import { requireCurrency } from "./validation.ts";

export type FinancialReviewCategory = "FINANCES" | "DATA_KIOSK" | "SELBOX";
export type FinancialReviewSource = "FINANCES" | "DATA_KIOSK";

export interface FinancialReviewRecordFilters {
  source?: FinancialReviewSource;
  type?: string;
}

export interface FinancialReviewBounds {
  firstMonth: string | null;
  lastMonth: string | null;
}

export const FINANCIAL_REVIEW_TOTAL_COLUMNS = [
  "month",
  "category",
  "currency",
  "finances_amount",
  "data_kiosk_amount",
  "difference",
  "finances_row_count",
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
  if (!["FINANCES", "DATA_KIOSK", "SELBOX"].includes(category))
    throw new Error("Choose a valid financial review category");
}

function requireMonth(month: string): void {
  requireCalendarDate(`${month}-01`);
}

export function requireFinancialReviewYear(year: string): void {
  if (typeof year !== "string" || !/^(?!0000)\d{4}$/.test(year))
    throw new Error("Choose a valid financial review year");
}

function returnedMonth(date: string | null | undefined): string {
  if (!date) throw new Error("Financial review returned an invalid month");
  requireCalendarDate(date);
  if (!date.endsWith("-01")) throw new Error("Financial review returned an invalid month");
  return date.slice(0, 7);
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
  requireCurrency(currency);
  validatePagination(pageIndex, DETAIL_PAGE_SIZE);
  params.set("limit", String(DETAIL_PAGE_SIZE));
  params.set("offset", String(pageIndex * DETAIL_PAGE_SIZE));
}

export function createFinancialReviewApi(transport: ApiTransport) {
  async function readBoundaryMonth(
    accessToken: string,
    category: FinancialReviewCategory,
    direction: "asc" | "desc",
    signal?: AbortSignal,
  ): Promise<string | null> {
    const params = scopeParams(category);
    params.set("select", "activity_date");
    params.set("order", `activity_date.${direction}`);
    params.set("limit", "1");
    const result = await transport.readCsvPage(
      accessToken,
      "financial_review_records",
      params,
      "Financial review date bounds",
      signal,
      false,
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length > 1) throw new Error("Financial review returned too many date bounds");
    const date = result.rows[0].activity_date;
    if (!date) throw new Error("Financial review returned an invalid activity date");
    requireCalendarDate(date);
    return date.slice(0, 7);
  }

  async function readTotals(
    accessToken: string,
    category: FinancialReviewCategory,
    firstMonth: string,
    lastMonth: string,
    currency: string | undefined,
    signal?: AbortSignal,
  ): Promise<CanonicalRow[]> {
    const params = totalParams(category, firstMonth, lastMonth);
    if (currency !== undefined) {
      requireCurrency(currency);
      params.set("currency", `eq.${currency}`);
    }
    params.set("select", rpcProjection(FINANCIAL_REVIEW_TOTAL_COLUMNS));
    params.set("order", "month.asc,currency.asc");
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
      throw new Error("Financial review returned too many monthly currencies");
    const scopes = new Set<string>();
    for (const row of result.rows) {
      const month = returnedMonth(row.month);
      if (month < firstMonth || month > lastMonth)
        throw new Error("Financial review returned a month outside the requested range");
      const rowCurrency = row.currency ?? "";
      requireCurrency(rowCurrency);
      if (currency !== undefined && rowCurrency !== currency)
        throw new Error("Financial review returned a different currency");
      const scope = `${month}:${rowCurrency}`;
      if (scopes.has(scope)) throw new Error("Financial review repeated a monthly currency");
      scopes.add(scope);
    }
    return result.rows;
  }

  return {
    async fetchFinancialReviewBounds(
      accessToken: string,
      category: FinancialReviewCategory,
      signal?: AbortSignal,
    ): Promise<FinancialReviewBounds> {
      requireFinancialReviewCategory(category);
      const [firstMonth, lastMonth] = await Promise.all([
        readBoundaryMonth(accessToken, category, "asc", signal),
        readBoundaryMonth(accessToken, category, "desc", signal),
      ]);
      if (
        (firstMonth === null) !== (lastMonth === null) ||
        (firstMonth && lastMonth && firstMonth > lastMonth)
      )
        throw new Error("Financial review returned inconsistent date bounds");
      return { firstMonth, lastMonth };
    },
    async fetchFinancialReviewPeriod(
      accessToken: string,
      category: FinancialReviewCategory,
      year: string,
      signal?: AbortSignal,
    ): Promise<CanonicalRow[]> {
      requireFinancialReviewYear(year);
      return readTotals(accessToken, category, `${year}-01`, `${year}-12`, undefined, signal);
    },
    async fetchFinancialReviewTotals(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      signal?: AbortSignal,
    ): Promise<CanonicalRow[]> {
      requireCurrency(currency);
      return readTotals(accessToken, category, month, month, currency, signal);
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
    async fetchFinancialReviewFamilyTypes(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      signal?: AbortSignal,
    ): Promise<CanonicalRow[]> {
      const params = totalParams(category, month);
      requireCurrency(currency);
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
      params.set("limit", String(LOOKUP_PAGE_SIZE));
      const result = await transport.readCsvPage(
        accessToken,
        "rpc/financial_review_type_totals",
        params,
        "Financial review fee families",
        signal,
        false,
      );
      if (result.rows.length >= LOOKUP_PAGE_SIZE)
        throw new Error("Too many types for a complete family comparison");
      for (const row of result.rows) {
        if (row.month !== `${month}-01` || row.category !== category || row.currency !== currency)
          throw new Error("Fee family comparison returned a different scope");
      }
      return result.rows;
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
        if (!["FINANCES", "DATA_KIOSK"].includes(filters.source))
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
