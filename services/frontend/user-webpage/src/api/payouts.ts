import marketplaces from "../generated/marketplaces.json" with { type: "json" };
import { requireCalendarDate } from "./filters.ts";
import { validatePagination } from "./pagination.ts";
import { isJsonObject, isUuid, requireUuid } from "./validation.ts";
import type { ApiTransport } from "./transport.ts";

export const PAYOUT_DETAIL_PAGE_SIZE = 50;

export const PAYOUT_MARKETPLACE_COLUMNS = [
  "report_id",
  "marketplace_name",
  "source_amount",
  "fee_amount",
  "company_amount",
] as const;

export const PAYOUT_COMPONENT_COLUMNS = [
  "id",
  "source",
  "sku",
  "marketplace_name",
  "activity_date",
  "component_type",
  "source_amount",
  "quantity",
  "fee_amount",
  "company_amount",
] as const;

export const PAYOUT_RECONCILIATION_COLUMNS = [
  "row_number",
  "activity_date",
  "marketplace_name",
  "currency",
  "settlement_category_amount",
  "selbox_category_amount",
  "data_kiosk_settlement_control",
  "data_kiosk_category_amount",
  "difference",
  "settlement_total",
  "accounted_total",
] as const;

export interface PayoutPolicy {
  mature_cutoff_date: string;
  latest_month: string;
  mature_cutoff_months: number;
}

export interface PayoutGenerationResult {
  report_id: string;
  created: boolean;
}

function reportPageParams(
  reportId: string,
  pageIndex: number,
  columns: readonly string[],
): URLSearchParams {
  requireUuid(reportId, "report");
  validatePagination(pageIndex, PAYOUT_DETAIL_PAGE_SIZE);
  return new URLSearchParams({
    select: columns.join(","),
    report_id: `eq.${reportId}`,
    order: "row_number.asc",
    limit: String(PAYOUT_DETAIL_PAGE_SIZE),
    offset: String(pageIndex * PAYOUT_DETAIL_PAGE_SIZE),
  });
}

export function createPayoutApi(transport: ApiTransport) {
  return {
    async fetchPayoutPolicy(accessToken: string, signal?: AbortSignal): Promise<PayoutPolicy> {
      const value = await transport.postRpc(
        accessToken,
        "payout_report_policy",
        {},
        "Payout policy",
        signal,
      );
      if (
        !isJsonObject(value) ||
        typeof value.mature_cutoff_date !== "string" ||
        typeof value.latest_month !== "string" ||
        typeof value.mature_cutoff_months !== "number" ||
        !Number.isSafeInteger(value.mature_cutoff_months) ||
        value.mature_cutoff_months < 1
      )
        throw new Error("Payout policy returned invalid dates");
      requireCalendarDate(value.mature_cutoff_date);
      requireCalendarDate(value.latest_month);
      if (!value.latest_month.endsWith("-01"))
        throw new Error("Payout policy returned an invalid month");
      return {
        mature_cutoff_date: value.mature_cutoff_date,
        latest_month: value.latest_month,
        mature_cutoff_months: value.mature_cutoff_months,
      };
    },
    async generatePayoutReports(
      accessToken: string,
      companyId: string,
      month: string,
    ): Promise<PayoutGenerationResult[]> {
      requireUuid(companyId, "company");
      requireCalendarDate(month);
      if (!month.endsWith("-01")) throw new Error("Choose a complete calendar month");
      const value = await transport.postRpc(
        accessToken,
        "generate_company_payout_reports",
        { p_company_id: companyId, p_month: month },
        "Generate payout reports",
      );
      if (!Array.isArray(value) || value.length === 0)
        throw new Error("Payout generation returned invalid results");
      const reportIds = new Set<string>();
      return value.map((row: unknown) => {
        if (
          !isJsonObject(row) ||
          !isUuid(row.report_id) ||
          typeof row.created !== "boolean" ||
          reportIds.has(row.report_id)
        )
          throw new Error("Payout generation returned invalid results");
        reportIds.add(row.report_id);
        return { report_id: row.report_id, created: row.created };
      });
    },
    async fetchPayoutMarketplaceTotals(
      accessToken: string,
      reportId: string,
      signal?: AbortSignal,
    ) {
      requireUuid(reportId, "report");
      const result = await transport.readCsvPage(
        accessToken,
        "payout_report_marketplace_totals",
        new URLSearchParams({
          select: PAYOUT_MARKETPLACE_COLUMNS.join(","),
          report_id: `eq.${reportId}`,
          order: "marketplace_name.asc.nullslast",
          // The canonical catalog plus the unspecified-marketplace group.
          limit: String(marketplaces.length + 1),
        }),
        "Payout marketplace breakdown",
        signal,
        false,
      );
      return result.rows;
    },
    async fetchPayoutComponents(
      accessToken: string,
      reportId: string,
      authoritative: boolean,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      const params = reportPageParams(reportId, pageIndex, PAYOUT_COMPONENT_COLUMNS);
      params.set("authoritative", `eq.${String(authoritative)}`);
      return transport.readCsvPage(
        accessToken,
        "company_payout_report_components",
        params,
        "Payout details",
        signal,
      );
    },
    async fetchPayoutReconciliation(
      accessToken: string,
      reportId: string,
      pageIndex: number,
      signal?: AbortSignal,
    ) {
      return transport.readCsvPage(
        accessToken,
        "payout_report_reconciliation",
        reportPageParams(reportId, pageIndex, PAYOUT_RECONCILIATION_COLUMNS),
        "Payout reconciliation",
        signal,
      );
    },
  };
}
