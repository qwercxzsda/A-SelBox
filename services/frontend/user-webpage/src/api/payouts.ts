import { requireCalendarDate, textSelectionValues } from "./filters.ts";
import { decodeTypeTotals } from "./aggregates.ts";
import { readOffsetRpcRows } from "./rpc-pagination.ts";
import { DETAIL_PAGE_SIZE, LOOKUP_PAGE_SIZE, validatePagination } from "./pagination.ts";
import { isJsonObject, requireUuid } from "./validation.ts";
import type { ApiTransport } from "./transport.ts";

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

interface PayoutPolicy {
  mature_cutoff_date: string;
  latest_month: string;
  mature_cutoff_months: number;
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
    async fetchPayoutComponents(
      accessToken: string,
      reportId: string,
      authoritative: boolean,
      pageIndex: number,
      signal?: AbortSignal,
      types: string[] = [],
    ) {
      requireUuid(reportId, "report");
      validatePagination(pageIndex, DETAIL_PAGE_SIZE);
      const params = new URLSearchParams({
        select: PAYOUT_COMPONENT_COLUMNS.join(","),
        report_id: `eq.${reportId}`,
        order: "activity_date.desc,source.desc,source_row_id.desc,id.desc",
        limit: String(DETAIL_PAGE_SIZE),
        offset: String(pageIndex * DETAIL_PAGE_SIZE),
        authoritative: `eq.${String(authoritative)}`,
      });
      const selectedTypes = textSelectionValues("component_type", types);
      if (selectedTypes.length > 0)
        params.set(
          "component_type",
          `in.(${selectedTypes.map((type) => JSON.stringify(type)).join(",")})`,
        );
      return transport.readCsvPage(
        accessToken,
        "company_payout_report_components",
        params,
        "Payout details",
        signal,
      );
    },
    async fetchPayoutTypeTotals(
      accessToken: string,
      reportId: string,
      currency: string,
      signal?: AbortSignal,
    ) {
      requireUuid(reportId, "report");
      return readOffsetRpcRows(
        (offset) =>
          transport.postRpc(
            accessToken,
            "payout_report_totals",
            {
              p_report_id: reportId,
              p_group_by_type: true,
              p_limit: LOOKUP_PAGE_SIZE,
              p_offset: offset,
            },
            "Payout amounts by type",
            signal,
          ),
        (rows) => decodeTypeTotals(rows, currency),
        (row) => row.type,
        "Payout amounts by type",
        signal,
      );
    },
  };
}
