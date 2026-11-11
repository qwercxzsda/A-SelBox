import { requireCalendarDate, companySelectionValues } from "./filters.ts";
import { validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { requireUuid } from "./validation.ts";
import { parseExactCount } from "./content-range.ts";

const PAYOUT_READINESS_PAGE_SIZE = 25;
const FAILURE_REASONS = ["SETUP_REQUIRED", "SOURCE_REQUIRED", "PROCESSING_FAILED"] as const;
export interface PayoutReadinessFacts {
  company_id: string;
  company_name: string;
  month: string;
  eligible: boolean;
  mature: boolean;
  refresh_pending: boolean;
  failure_count: number;
  failure_reason: (typeof FAILURE_REASONS)[number] | null;
  has_report: boolean;
  has_activity: boolean;
  last_success_at: string | null;
  next_attempt_at: string | null;
}
interface PayoutReadinessPage<T> {
  rows: T[];
  hasNext: boolean;
}

function booleanField(row: CanonicalRow, field: string): boolean {
  if (row[field] === "t") return true;
  if (row[field] === "f") return false;
  throw new Error(`Payout readiness returned an invalid ${field}`);
}

function nullableText(row: CanonicalRow, field: string): string | null {
  const value = row[field];
  if (value === null || typeof value === "string") return value;
  throw new Error(`Payout readiness omitted ${field}`);
}

function decodeReadiness(
  row: CanonicalRow,
  date: string,
  companies: string[],
): PayoutReadinessFacts {
  const company = row.company_id ?? "";
  requireUuid(company, "company");
  if (companies.length && !companies.includes(company))
    throw new Error("Payout readiness returned a different company");
  if (row.month !== date || typeof row.company_name !== "string" || !row.company_name.trim())
    throw new Error("Payout readiness returned an invalid scope");
  const failureReason = FAILURE_REASONS.find((value) => value === row.failure_reason);
  if (row.failure_reason !== null && !failureReason)
    throw new Error("Payout readiness returned an invalid failure reason");
  return {
    company_id: company,
    company_name: row.company_name,
    month: date,
    eligible: booleanField(row, "eligible"),
    mature: booleanField(row, "mature"),
    refresh_pending: booleanField(row, "refresh_pending"),
    failure_count: parseExactCount(row.failure_count),
    failure_reason: failureReason ?? null,
    has_report: booleanField(row, "has_report"),
    has_activity: booleanField(row, "has_activity"),
    last_success_at: nullableText(row, "last_success_at"),
    next_attempt_at: nullableText(row, "next_attempt_at"),
  };
}

function monthDate(month: string): string {
  const date = `${month}-01`;
  requireCalendarDate(date);
  return date;
}

function pageParams(pageIndex: number): Record<string, string> {
  validatePagination(pageIndex, PAYOUT_READINESS_PAGE_SIZE);
  return {
    p_limit: String(PAYOUT_READINESS_PAGE_SIZE + 1),
    p_offset: String(pageIndex * PAYOUT_READINESS_PAGE_SIZE),
  };
}

function page<T>(rows: T[]): PayoutReadinessPage<T> {
  if (rows.length > PAYOUT_READINESS_PAGE_SIZE + 1)
    throw new Error("Payout readiness returned an oversized page");
  return {
    rows: rows.slice(0, PAYOUT_READINESS_PAGE_SIZE),
    hasNext: rows.length > PAYOUT_READINESS_PAGE_SIZE,
  };
}

export function createPayoutReadinessApi(transport: ApiTransport) {
  return {
    async fetchPayoutReadiness(
      accessToken: string,
      month: string,
      companyIds: string[] = [],
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<PayoutReadinessPage<PayoutReadinessFacts>> {
      const date = monthDate(month);
      const companies = companySelectionValues(companyIds);
      const params = new URLSearchParams({
        p_month: date,
        ...pageParams(pageIndex),
        // PostgREST orders RPC CSV headers alphabetically.
        select:
          "company_id,company_name,eligible,failure_count,failure_reason,has_activity,has_report,last_success_at,mature,month,next_attempt_at,refresh_pending",
      });
      if (companies.length > 100) throw new Error("Choose at most 100 companies");
      if (companies.length) params.set("p_company_ids", `{${companies.join(",")}}`);
      const result = await transport.readCsvPage(
        accessToken,
        "rpc/payout_readiness",
        params,
        "Payout readiness",
        signal,
        false,
      );
      return page(result.rows.map((row) => decodeReadiness(row, date, companies)));
    },
    async fetchPayoutSetupBlockers(
      accessToken: string,
      companyId: string,
      month: string,
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<PayoutReadinessPage<CanonicalRow>> {
      requireUuid(companyId, "company");
      const params = new URLSearchParams({
        p_company_id: companyId,
        p_month: monthDate(month),
        ...pageParams(pageIndex),
        select: "component_count,first_date,last_date,marketplace_name,reason,sku",
      });
      const result = await transport.readCsvPage(
        accessToken,
        "rpc/payout_setup_blockers",
        params,
        "Payout setup requirements",
        signal,
        false,
      );
      return page(result.rows);
    },
  };
}
