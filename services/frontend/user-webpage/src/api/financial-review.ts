import { sumExactDecimals } from "../decimal.ts";
import { requireCalendarDate } from "./filters.ts";
import { marketplaceCurrency } from "./marketplace-currencies.ts";
import { requireMarketplace } from "./marketplaces.ts";
import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { isUuid, knownCode } from "./validation.ts";

/** Why a Finances amount cannot reach a company yet, in display and stacking order. */
export const REVIEW_REASONS = [
  "NO_ASSIGNMENT",
  "REFERENCE_NOT_FOUND",
  "ROUNDING",
  "TOTALS_DIFFER",
  "CHARGED_IN_ANOTHER_MONTH",
  "SPLIT_OWNERSHIP",
  "LEDGER_MONTH_NOT_LOADED",
  "NOT_IN_LEDGER",
  "NO_ID_ON_CHARGE",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
export const SELBOX_GROUPS = ["ACCOUNT_FEE", "BALANCE_MOVEMENT", "TAX_RECLASSIFICATION"] as const;
export type SelboxGroup = (typeof SELBOX_GROUPS)[number];
const REVIEW_MEASURES = ["FINANCES", "COMPANY", "SELBOX", "DIFFERENCE"] as const;
export type ReviewMeasure = (typeof REVIEW_MEASURES)[number];
/**
 * Where an outcome record comes from. KEY marks a balancing entry (rounding, totals differ,
 * charged in another month) computed from the Finances charge that the record's IDs name.
 */
const OUTCOME_SOURCES = [
  "FINANCES",
  "KEY",
  "AD_INVOICE",
  "STORAGE",
  "AGED_STORAGE",
  "REMOVAL_ORDER",
] as const;

export function asReviewReason(value: unknown): ReviewReason | null {
  return REVIEW_REASONS.find((reason) => reason === value) ?? null;
}

export function asSelboxGroup(value: unknown): SelboxGroup | null {
  return SELBOX_GROUPS.find((group) => group === value) ?? null;
}

/** The outcomes whose records the month drawer lists. */
export type ReviewOutcome = "DIFFERENCE" | "SELBOX";

export interface ReviewScope {
  marketplace: string;
  year: number;
}

/** One measure of one month, summed across seller accounts. Amounts are exact decimals. */
export interface ReviewMonthRow {
  /** YYYY-MM */
  month: string;
  measure: ReviewMeasure;
  reason: ReviewReason | null;
  selboxGroup: SelboxGroup | null;
  baseAmount: string;
  taxAmount: string;
  count: number;
}

export interface OutcomeFilters {
  outcome: ReviewOutcome;
  marketplace: string;
  /** YYYY-MM */
  month: string;
  reason: ReviewReason | null;
  selboxGroup: SelboxGroup | null;
}

const MONTH_COLUMNS = [
  "amount_count",
  "base_amount",
  "currency",
  "measure",
  "month",
  "reason",
  "selbox_group",
  "tax_amount",
];
const OUTCOME_COLUMNS = [
  "asin",
  "base_amount",
  "component_type",
  "currency",
  "fnsku",
  "marketplace_name",
  "outcome",
  "posted_date",
  "reason",
  "reference_id",
  "selbox_group",
  "sku",
  "skus",
  "source",
  "source_row_id",
  "source_version_id",
  "tax_amount",
];

function requireAmount(value: string | null, label: string): string {
  if (value === null || sumExactDecimals([value]) === null)
    throw new Error(`Financial review returned an invalid ${label}`);
  return value;
}

/** Every review row must be in its marketplace's one currency; no other currency is shown. */
function requireMarketplaceCurrency(row: CanonicalRow, marketplace: string) {
  const expected = marketplaceCurrency(marketplace);
  if (row.currency !== expected)
    throw new Error(
      `Financial review returned ${row.currency ?? "no currency"} for ${marketplace}, which charges in ${expected}`,
    );
}

function decodeMonthRow(row: CanonicalRow, { marketplace, year }: ReviewScope): ReviewMonthRow {
  const date = row.month ?? "";
  requireCalendarDate(date);
  if (!date.endsWith("-01") || date.slice(0, 4) !== String(year).padStart(4, "0"))
    throw new Error(`Financial review returned a month outside ${String(year)}`);
  requireMarketplaceCurrency(row, marketplace);
  const measure = knownCode(REVIEW_MEASURES, row.measure, "review measure");
  const reason =
    measure === "DIFFERENCE" ? knownCode(REVIEW_REASONS, row.reason, "difference reason") : null;
  const selboxGroup =
    measure === "SELBOX" ? knownCode(SELBOX_GROUPS, row.selbox_group, "SelBox group") : null;
  if (
    (reason === null && row.reason !== null) ||
    (selboxGroup === null && row.selbox_group !== null)
  )
    throw new Error(`Financial review returned a reason or group for ${measure}`);
  const count = Number(row.amount_count);
  if (!/^\d+$/.test(row.amount_count ?? "") || !Number.isSafeInteger(count))
    throw new Error("Financial review returned an invalid record count");
  return {
    month: date.slice(0, 7),
    measure,
    reason,
    selboxGroup,
    baseAmount: requireAmount(row.base_amount, "base amount"),
    taxAmount: requireAmount(row.tax_amount, "tax amount"),
    count,
  };
}

function requireOutcomeRow(row: CanonicalRow, filters: OutcomeFilters) {
  const { outcome, marketplace, month, reason, selboxGroup } = filters;
  if (row.outcome !== outcome || row.marketplace_name !== marketplace)
    throw new Error("Financial review returned a record outside the selected scope");
  requireMarketplaceCurrency(row, marketplace);
  const posted = row.posted_date ?? "";
  requireCalendarDate(posted);
  if (posted.slice(0, 7) !== month)
    throw new Error("Financial review returned a record outside the selected month");
  if (!isUuid(row.source_row_id) || !isUuid(row.source_version_id))
    throw new Error("Financial review returned a record without its source");
  knownCode(OUTCOME_SOURCES, row.source, "record source");
  if (outcome === "DIFFERENCE") {
    const code = knownCode(REVIEW_REASONS, row.reason, "difference reason");
    if (reason && code !== reason) throw new Error("Financial review returned another reason");
  } else {
    const code = knownCode(SELBOX_GROUPS, row.selbox_group, "SelBox group");
    if (selboxGroup && code !== selboxGroup)
      throw new Error("Financial review returned another SelBox group");
  }
  requireAmount(row.base_amount, "base amount");
  requireAmount(row.tax_amount, "tax amount");
  const resolved: unknown = JSON.parse(row.skus ?? "[]");
  if (!Array.isArray(resolved) || !resolved.every((sku: unknown) => typeof sku === "string"))
    throw new Error("Invalid resolved SKU list");
  // Shared charges resolve to several SKUs; show them where a direct charge names one.
  return { ...row, sku: row.sku ?? (resolved.join(", ") || null) };
}

export function createFinancialReviewApi(transport: ApiTransport) {
  return {
    /** Every measure of one marketplace-year: Finances, Company, SelBox by group, Difference by reason. */
    async fetchReviewMonths(token: string, scope: ReviewScope, signal?: AbortSignal) {
      requireMarketplace(scope.marketplace);
      if (!Number.isSafeInteger(scope.year) || scope.year < 1 || scope.year > 9999)
        throw new Error("Choose a calendar year");
      const params = new URLSearchParams({
        // PostgREST emits RPC CSV headers alphabetically; request values in the same order.
        select: MONTH_COLUMNS.join(","),
        p_marketplace: scope.marketplace,
        p_year: String(scope.year),
      });
      const { rows } = await transport.readCsvPage(
        token,
        "rpc/financial_review_months",
        params,
        "Financial review",
        signal,
        false,
      );
      return rows.map((row) => decodeMonthRow(row, scope));
    },
    /** One page of a month's records; the months' amount_count is its exact total. */
    async fetchFinancialOutcomes(
      token: string,
      filters: OutcomeFilters,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      validatePagination(pageIndex, DETAIL_PAGE_SIZE);
      requireMarketplace(filters.marketplace);
      const start = `${filters.month}-01`;
      requireCalendarDate(start);
      const params = new URLSearchParams({
        select: OUTCOME_COLUMNS.join(","),
        p_outcome: filters.outcome,
        p_month: start,
        p_marketplace: filters.marketplace,
        p_limit: String(DETAIL_PAGE_SIZE),
        p_offset: String(pageIndex * DETAIL_PAGE_SIZE),
      });
      if (filters.reason) params.set("p_reason", filters.reason);
      if (filters.selboxGroup) params.set("p_selbox_group", filters.selboxGroup);
      const { rows } = await transport.readCsvPage(
        token,
        "rpc/financial_outcome_page",
        params,
        "Financial review records",
        signal,
        false,
      );
      if (rows.length > DETAIL_PAGE_SIZE)
        throw new Error("Financial review returned more records than requested");
      return rows.map((row) => requireOutcomeRow(row, filters));
    },
  };
}
