import { sumExactDecimals } from "../decimal.ts";
import { parseExactCount } from "./content-range.ts";
import { requireCalendarDate } from "./filters.ts";
import { requireMarketplace } from "./marketplaces.ts";
import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import { isJsonObject, requireCurrency, requireUuid } from "./validation.ts";

export type SourceName = "FINANCES" | "DATA_KIOSK";
export type SourceCategory = "FINANCES" | "DATA_KIOSK" | "SELBOX";
export type SourceGrouping = "total" | "month" | "day";
export interface SourceTotalRow {
  seller_namespace: string | null;
  period: string | null;
  marketplace_name: string | null;
  currency: string;
  source: SourceName;
  category: SourceCategory;
  amount: string;
  row_count: string;
}
export interface SourceCoverage {
  source: SourceName;
  seller_namespace: string;
  start_date: string;
  end_date: string;
}
export interface SourceTotals {
  scope: {
    start_date: string;
    end_date: string;
    marketplace_name: string | null;
    currency: string | null;
    report_id?: string;
  };
  revision: { finances: string; data_kiosk: string } | null;
  rows: SourceTotalRow[];
  coverage: SourceCoverage[];
  totalCount: number;
  nextOffset: number | null;
  grouping: SourceGrouping;
}
export interface CurrentSourceScope {
  startDate: string;
  endDate: string;
  marketplace: string;
  currency?: string;
  category?: SourceCategory;
  grouping?: SourceGrouping;
  pageIndex?: number;
}
export interface ReportSourceScope {
  reportId: string;
  grouping?: SourceGrouping;
  pageIndex?: number;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`Source totals returned invalid ${field}`);
  return value;
}
function date(value: unknown): string {
  const result = text(value, "date");
  requireCalendarDate(result);
  return result;
}
function source(value: unknown): SourceName {
  if (value !== "FINANCES" && value !== "DATA_KIOSK")
    throw new Error("Source totals returned an invalid source");
  return value;
}
function category(value: unknown): SourceCategory {
  if (value !== "FINANCES" && value !== "DATA_KIOSK" && value !== "SELBOX")
    throw new Error("Source totals returned an invalid category");
  return value;
}
function grouping(value: SourceGrouping | undefined): SourceGrouping {
  const result = value ?? "total";
  if (!["total", "month", "day"].includes(result))
    throw new Error("Choose a valid source grouping");
  return result;
}

/** Validate one atomic native aggregate response before any diagnostic arithmetic. */
export function decodeSourceTotals(
  value: unknown,
  requested: CurrentSourceScope | ReportSourceScope,
): SourceTotals {
  if (
    !isJsonObject(value) ||
    !isJsonObject(value.scope) ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.coverage)
  )
    throw new Error("Source totals returned an invalid response");
  const report = "reportId" in requested;
  const group = grouping(requested.grouping);
  const scope: SourceTotals["scope"] = {
    start_date: date(value.scope.start_date),
    end_date: date(value.scope.end_date),
    marketplace_name:
      value.scope.marketplace_name === null
        ? null
        : text(value.scope.marketplace_name, "marketplace"),
    currency: value.scope.currency === null ? null : text(value.scope.currency, "currency"),
    ...(report ? { report_id: text(value.scope.report_id, "report") } : {}),
  };
  if (scope.marketplace_name !== null) requireMarketplace(scope.marketplace_name);
  if (scope.currency !== null) requireCurrency(scope.currency);
  if (
    scope.start_date > scope.end_date ||
    (report
      ? scope.report_id !== requested.reportId
      : scope.start_date !== requested.startDate ||
        scope.end_date !== requested.endDate ||
        scope.marketplace_name !== requested.marketplace ||
        scope.currency !== (requested.currency ?? null))
  )
    throw new Error("Source totals returned a different scope");
  let revision: SourceTotals["revision"] = null;
  if (report) {
    if (value.revision !== null) throw new Error("Saved source totals returned mutable revisions");
  } else {
    if (!isJsonObject(value.revision)) throw new Error("Source totals returned invalid revisions");
    revision = {
      finances: text(value.revision.finances, "Finance revision"),
      data_kiosk: text(value.revision.data_kiosk, "Data Kiosk revision"),
    };
  }
  const seen = new Set<string>();
  const buckets = new Set<string>();
  const rows = value.rows.map((entry): SourceTotalRow => {
    if (!isJsonObject(entry)) throw new Error("Source totals returned an invalid row");
    const row: SourceTotalRow = {
      seller_namespace:
        entry.seller_namespace === null ? null : text(entry.seller_namespace, "seller"),
      period: entry.period === null ? null : date(entry.period),
      marketplace_name:
        entry.marketplace_name === null ? null : text(entry.marketplace_name, "marketplace"),
      currency: text(entry.currency, "currency"),
      source: source(entry.source),
      category: category(entry.category),
      amount: text(entry.amount, "amount"),
      row_count: text(entry.row_count, "row count"),
    };
    requireCurrency(row.currency);
    sumExactDecimals([row.amount]);
    if (
      !/^[1-9]\d*$/.test(row.row_count) ||
      row.marketplace_name !== scope.marketplace_name ||
      (scope.currency !== null && row.currency !== scope.currency) ||
      (!report && requested.category !== undefined && row.category !== requested.category) ||
      (group === "total" ? row.period !== null : row.period === null) ||
      (group === "day" ? row.seller_namespace === null : row.seller_namespace !== null) ||
      (row.period !== null &&
        (row.period > scope.end_date ||
          (group === "month"
            ? !row.period.endsWith("-01") || row.period.slice(0, 7) < scope.start_date.slice(0, 7)
            : row.period < scope.start_date)))
    )
      throw new Error("Source totals returned an invalid row scope");
    const bucket = JSON.stringify([
      row.seller_namespace,
      row.period,
      row.marketplace_name,
      row.currency,
    ]);
    const key = `${bucket}:${row.source}:${row.category}`;
    if (seen.has(key)) throw new Error("Source totals repeated a source/category group");
    seen.add(key);
    buckets.add(bucket);
    return row;
  });
  const coverage = value.coverage.map((entry): SourceCoverage => {
    if (!isJsonObject(entry)) throw new Error("Source totals returned invalid coverage");
    const item = {
      source: source(entry.source),
      seller_namespace: text(entry.seller_namespace, "coverage seller"),
      start_date: date(entry.start_date),
      end_date: date(entry.end_date),
    };
    if (
      item.start_date < scope.start_date ||
      item.end_date > scope.end_date ||
      item.start_date > item.end_date
    )
      throw new Error("Source totals returned coverage outside the requested scope");
    return item;
  });
  const totalCount = parseExactCount(value.total_count);
  const offset = (requested.pageIndex ?? 0) * DETAIL_PAGE_SIZE;
  const expectedBuckets =
    group === "day" ? Math.min(DETAIL_PAGE_SIZE, Math.max(0, totalCount - offset)) : totalCount;
  const nextOffset =
    group === "day" && offset + buckets.size < totalCount ? offset + buckets.size : null;
  if (buckets.size !== expectedBuckets || value.next_offset !== nextOffset)
    throw new Error("Source totals returned incomplete comparison groups");
  return { scope, revision, rows, coverage, totalCount, nextOffset, grouping: group };
}

export function createSourceTotalsApi(transport: ApiTransport) {
  return {
    async fetchCurrentSourceTotals(
      accessToken: string,
      scope: CurrentSourceScope,
      signal?: AbortSignal,
    ): Promise<SourceTotals> {
      requireCalendarDate(scope.startDate);
      requireCalendarDate(scope.endDate);
      requireMarketplace(scope.marketplace);
      if (scope.startDate > scope.endDate) throw new Error("Choose an ordered source period");
      if (scope.currency !== undefined) requireCurrency(scope.currency);
      if (scope.category !== undefined) category(scope.category);
      validatePagination(scope.pageIndex ?? 0, DETAIL_PAGE_SIZE);
      const value = await transport.postRpc(
        accessToken,
        "current_source_totals",
        {
          p_start: scope.startDate,
          p_end: scope.endDate,
          p_marketplace: scope.marketplace,
          p_grouping: grouping(scope.grouping),
          p_currency: scope.currency ?? null,
          p_category: scope.category ?? null,
          p_limit: DETAIL_PAGE_SIZE,
          p_offset: (scope.pageIndex ?? 0) * DETAIL_PAGE_SIZE,
        },
        "Current source totals",
        signal,
      );
      return decodeSourceTotals(value, scope);
    },
    async fetchReportSourceTotals(
      accessToken: string,
      scope: ReportSourceScope,
      signal?: AbortSignal,
    ): Promise<SourceTotals> {
      requireUuid(scope.reportId, "report");
      validatePagination(scope.pageIndex ?? 0, DETAIL_PAGE_SIZE);
      const value = await transport.postRpc(
        accessToken,
        "report_source_totals",
        {
          p_report_id: scope.reportId,
          p_grouping: grouping(scope.grouping),
          p_limit: DETAIL_PAGE_SIZE,
          p_offset: (scope.pageIndex ?? 0) * DETAIL_PAGE_SIZE,
        },
        "Saved report source totals",
        signal,
      );
      return decodeSourceTotals(value, scope);
    },
  };
}
