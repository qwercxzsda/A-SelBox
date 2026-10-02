import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import { requireUuid } from "./validation.ts";
import type { ApiTransport } from "./transport.ts";

const PAYOUT_RECONCILIATION_TOTAL_COLUMNS = [
  "currency",
  "settlement_category_amount",
  "selbox_category_amount",
  "data_kiosk_settlement_control",
  "data_kiosk_category_amount",
  "difference",
  "settlement_total",
  "accounted_total",
  "source_group_count",
] as const;

export function createPayoutReconciliationApi(transport: ApiTransport) {
  return {
    async fetchPayoutReconciliationTotals(
      accessToken: string,
      reportId: string,
      signal?: AbortSignal,
    ) {
      requireUuid(reportId, "report");
      const result = await transport.readCsvPage(
        accessToken,
        "payout_reconciliation_totals",
        new URLSearchParams({
          report_id: `eq.${reportId}`,
          select: PAYOUT_RECONCILIATION_TOTAL_COLUMNS.join(","),
          order: "currency.asc",
          limit: String(LOOKUP_PAGE_SIZE),
        }),
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
