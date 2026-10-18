import { DETAIL_PAGE_SIZE, LOOKUP_PAGE_SIZE, validatePagination } from "./pagination.ts";
import { requireCurrency, requireUuid } from "./validation.ts";
import type { ApiTransport } from "./transport.ts";

export const PAYOUT_RECONCILIATION_COLUMNS = [
  "row_number",
  "seller_namespace",
  "activity_date",
  "marketplace_name",
  "currency",
  "finances_category_amount",
  "selbox_category_amount",
  "data_kiosk_finances_control",
  "data_kiosk_category_amount",
  "difference",
  "finances_total",
  "accounted_total",
] as const;

const PAYOUT_RECONCILIATION_TOTAL_COLUMNS = [
  "currency",
  "finances_category_amount",
  "selbox_category_amount",
  "data_kiosk_finances_control",
  "data_kiosk_category_amount",
  "difference",
  "finances_total",
  "accounted_total",
  "source_group_count",
] as const;

/** Saved daily controls and totals must use the same report and currency scope. */
function reconciliationParams(reportId: string, currency?: string): URLSearchParams {
  requireUuid(reportId, "report");
  const params = new URLSearchParams({ report_id: `eq.${reportId}` });
  if (currency !== undefined) {
    requireCurrency(currency);
    params.set("currency", `eq.${currency}`);
  }
  return params;
}

export function createPayoutReconciliationApi(transport: ApiTransport) {
  return {
    async fetchPayoutReconciliation(
      accessToken: string,
      reportId: string,
      pageIndex: number,
      signal?: AbortSignal,
      currency?: string,
    ) {
      const params = reconciliationParams(reportId, currency);
      validatePagination(pageIndex, DETAIL_PAGE_SIZE);
      params.set("select", PAYOUT_RECONCILIATION_COLUMNS.join(","));
      params.set("order", "row_number.asc");
      params.set("limit", String(DETAIL_PAGE_SIZE));
      params.set("offset", String(pageIndex * DETAIL_PAGE_SIZE));
      return transport.readCsvPage(
        accessToken,
        "payout_report_reconciliation",
        params,
        "Payout reconciliation",
        signal,
      );
    },
    async fetchPayoutReconciliationTotals(
      accessToken: string,
      reportId: string,
      signal?: AbortSignal,
      currency?: string,
    ) {
      const params = reconciliationParams(reportId, currency);
      params.set("select", PAYOUT_RECONCILIATION_TOTAL_COLUMNS.join(","));
      params.set("order", "currency.asc");
      params.set("limit", String(LOOKUP_PAGE_SIZE));
      const result = await transport.readCsvPage(
        accessToken,
        "payout_reconciliation_totals",
        params,
        "Saved account reconciliation totals",
        signal,
        false,
      );
      if (result.rows.length >= LOOKUP_PAGE_SIZE)
        throw new Error("Saved account reconciliation returned too many currencies");
      return result.rows;
    },
  };
}
