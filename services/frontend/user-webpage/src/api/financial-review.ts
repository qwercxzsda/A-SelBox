import { feeFamilyTypeSelections } from "../fee-family-catalog.ts";
import { quotePostgrestText, requireCalendarDate, textSelectionValues } from "./filters.ts";
import {
  readCompleteFinancialReviewTypes,
  type FinancialReviewTypeScope,
  type SourceTypeTotals,
} from "./financial-review-type-reader.ts";
import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { PageResult } from "./types.ts";
import { requireCurrency } from "./validation.ts";
import { requireMarketplace } from "./marketplaces.ts";

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

const FINANCIAL_REVIEW_RECORD_COLUMNS = [
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

function requireFinancialReviewCategory(category: FinancialReviewCategory): void {
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

function scopeParams(category: FinancialReviewCategory, marketplace: string): URLSearchParams {
  requireFinancialReviewCategory(category);
  requireMarketplace(marketplace);
  return new URLSearchParams({ category: `eq.${category}`, marketplace_name: `eq.${marketplace}` });
}

function followingMonthDate(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${String(year + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(monthNumber + 1).padStart(2, "0")}-01`;
}

function setDetailPage(params: URLSearchParams, pageIndex: number): void {
  validatePagination(pageIndex, DETAIL_PAGE_SIZE);
  params.set("limit", String(DETAIL_PAGE_SIZE));
  params.set("offset", String(pageIndex * DETAIL_PAGE_SIZE));
}

function typeTotalParams(scope: FinancialReviewTypeScope): URLSearchParams {
  const { category, firstMonth, lastMonth, marketplace, currency } = scope;
  requireFinancialReviewCategory(category);
  requireMarketplace(marketplace);
  requireMonth(firstMonth);
  requireMonth(lastMonth);
  requireCurrency(currency);
  const params = new URLSearchParams({
    p_category: category,
    p_marketplace: marketplace,
    p_month_from: `${firstMonth}-01`,
    p_month_to: followingMonthDate(lastMonth),
    p_currency: currency,
  });
  params.set(
    "select",
    rpcProjection([
      "month",
      "category",
      "marketplace_name",
      "currency",
      "source",
      "component_type",
      "amount",
      "row_count",
    ]),
  );
  params.set("order", "source.asc,component_type.asc");
  return params;
}

function applyFeeFamilies(params: URLSearchParams, familyIds: readonly string[]): void {
  const selection = feeFamilyTypeSelections(familyIds);
  if (selection === null) return;
  const expressions = [
    ["FINANCES", selection.financesTypes],
    ["DATA_KIOSK", selection.dataKioskTypes],
  ] as const;
  const clauses = expressions.flatMap(([source, types]) => {
    const values = textSelectionValues("component_type", types);
    return values.length
      ? [`and(source.eq.${source},component_type.in.(${values.map(quotePostgrestText).join(",")}))`]
      : [];
  });
  if (!clauses.length) throw new Error("Choose at least one valid fee family");
  params.set("or", `(${clauses.join(",")})`);
}

export function createFinancialReviewApi(transport: ApiTransport) {
  async function readBoundaryMonth(
    accessToken: string,
    category: FinancialReviewCategory,
    marketplace: string,
    direction: "asc" | "desc",
    signal?: AbortSignal,
  ): Promise<string | null> {
    const params = scopeParams(category, marketplace);
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

  function readFamilyTypes(
    accessToken: string,
    scope: FinancialReviewTypeScope,
    signal?: AbortSignal,
  ) {
    return readCompleteFinancialReviewTypes(
      transport,
      accessToken,
      typeTotalParams(scope),
      scope,
      signal,
    );
  }

  return {
    async fetchFinancialReviewBounds(
      accessToken: string,
      category: FinancialReviewCategory,
      marketplace: string,
      signal?: AbortSignal,
    ): Promise<FinancialReviewBounds> {
      const [firstMonth, lastMonth] = await Promise.all([
        readBoundaryMonth(accessToken, category, marketplace, "asc", signal),
        readBoundaryMonth(accessToken, category, marketplace, "desc", signal),
      ]);
      if (
        (firstMonth === null) !== (lastMonth === null) ||
        (firstMonth && lastMonth && firstMonth > lastMonth)
      )
        throw new Error("Financial review returned inconsistent date bounds");
      return { firstMonth, lastMonth };
    },
    async fetchFinancialReviewPeriodTypes(
      accessToken: string,
      category: FinancialReviewCategory,
      year: string,
      currency: string,
      marketplace: string,
      signal?: AbortSignal,
    ): Promise<SourceTypeTotals> {
      requireFinancialReviewYear(year);
      return readFamilyTypes(
        accessToken,
        { category, firstMonth: `${year}-01`, lastMonth: `${year}-12`, currency, marketplace },
        signal,
      );
    },
    fetchFinancialReviewTypes(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      marketplace: string,
      pageIndex = 0,
      signal?: AbortSignal,
      familyIds: readonly string[] = [],
    ): Promise<PageResult> {
      const params = typeTotalParams({
        category,
        firstMonth: month,
        lastMonth: month,
        currency,
        marketplace,
      });
      applyFeeFamilies(params, familyIds);
      setDetailPage(params, pageIndex);
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
      marketplace: string,
      signal?: AbortSignal,
    ): Promise<SourceTypeTotals> {
      return readFamilyTypes(
        accessToken,
        { category, firstMonth: month, lastMonth: month, currency, marketplace },
        signal,
      );
    },
    fetchFinancialReviewRecords(
      accessToken: string,
      category: FinancialReviewCategory,
      month: string,
      currency: string,
      marketplace: string,
      pageIndex: number,
      filters: FinancialReviewRecordFilters = {},
      signal?: AbortSignal,
      familyIds: readonly string[] = [],
    ): Promise<PageResult> {
      const params = scopeParams(category, marketplace);
      requireMonth(month);
      requireCurrency(currency);
      applyFeeFamilies(params, familyIds);
      setDetailPage(params, pageIndex);
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
