import { requireCalendarDate, companySelectionValues } from "./filters.ts";
import { validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow } from "./types.ts";
import { requireUuid } from "./validation.ts";

export const PAYOUT_READINESS_PAGE_SIZE = 25;
export const PAYOUT_READINESS_STATUSES = [
  "PENDING",
  "UPDATING",
  "BLOCKED",
  "COMPLETE",
  "NO_ACTIVITY",
  "NOT_SCHEDULED",
  "IMMATURE",
] as const;
export type PayoutReadinessStatus = (typeof PAYOUT_READINESS_STATUSES)[number];

export interface PayoutReadinessPage {
  rows: CanonicalRow[];
  hasNext: boolean;
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

function page(rows: CanonicalRow[]): PayoutReadinessPage {
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
    ): Promise<PayoutReadinessPage> {
      const date = monthDate(month);
      const companies = companySelectionValues(companyIds);
      const params = new URLSearchParams({
        p_month: date,
        ...pageParams(pageIndex),
        // RPC CSV header ordering is alphabetical on the deployed serializer.
        select:
          "company_id,company_name,month,status,reason,has_report,last_success_at,next_attempt_at"
            .split(",")
            .sort()
            .join(","),
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
      for (const row of result.rows) {
        requireUuid(row.company_id ?? "", "company");
        if (companies.length && !companies.includes(row.company_id ?? ""))
          throw new Error("Payout readiness returned a different company");
        if (
          row.month !== date ||
          !PAYOUT_READINESS_STATUSES.some((status) => status === row.status)
        )
          throw new Error("Payout readiness returned an invalid scope or status");
      }
      return page(result.rows);
    },
    async fetchPayoutSetupBlockers(
      accessToken: string,
      companyId: string,
      month: string,
      pageIndex = 0,
      signal?: AbortSignal,
    ): Promise<PayoutReadinessPage> {
      requireUuid(companyId, "company");
      const params = new URLSearchParams({
        p_company_id: companyId,
        p_month: monthDate(month),
        ...pageParams(pageIndex),
        select: "sku,reason,marketplace_name,first_date,last_date,component_count"
          .split(",")
          .sort()
          .join(","),
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
