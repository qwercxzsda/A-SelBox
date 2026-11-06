import { DATASET_CONFIG } from "./config.ts";
import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow, PageResult } from "./types.ts";
import { requireUuid } from "./validation.ts";
import {
  payoutMarketplace,
  requirePayoutScope,
  type PayoutReportScope,
} from "../payout-report-scope.ts";

interface PayoutScopeOptions extends PayoutReportScope {
  accessToken: string;
  signal?: AbortSignal;
}

export interface FetchPayoutHistoryOptions extends PayoutScopeOptions {
  pageIndex: number;
}

export interface FetchPayoutVersionOptions extends PayoutScopeOptions {
  reportId: string;
}

function payoutScopeParams(scope: PayoutReportScope): URLSearchParams {
  requirePayoutScope(scope);
  const { companyId, startDate, endDate, currency, marketplaceName } = scope;
  return new URLSearchParams({
    select: DATASET_CONFIG.payouts.selectColumns.join(","),
    company_id: `eq.${companyId}`,
    start_date: `eq.${startDate}`,
    end_date: `eq.${endDate}`,
    currency: currency === null ? "is.null" : `eq.${currency}`,
    marketplace_name: marketplaceName === null ? "is.null" : `eq.${marketplaceName}`,
  });
}

export function createPayoutHistoryApi(transport: ApiTransport) {
  return {
    async fetchPayoutHistory(options: FetchPayoutHistoryOptions): Promise<PageResult> {
      const { accessToken, pageIndex, signal } = options;
      const params = payoutScopeParams(options);
      validatePagination(pageIndex, DETAIL_PAGE_SIZE);
      params.set("order", "created_at.desc,id.desc");
      params.set("limit", String(DETAIL_PAGE_SIZE));
      params.set("offset", String(pageIndex * DETAIL_PAGE_SIZE));

      const result = await transport.readCsvPage(
        accessToken,
        "company_payout_reports",
        params,
        "Payout report history",
        signal,
        true,
      );
      result.rows.forEach(payoutMarketplace);
      return result;
    },
    async fetchPayoutVersion(options: FetchPayoutVersionOptions): Promise<CanonicalRow | null> {
      const { accessToken, reportId, signal } = options;
      requireUuid(reportId, "report");
      const params = payoutScopeParams(options);
      params.set("id", `eq.${reportId}`);
      params.set("limit", "1");
      const result = await transport.readCsvPage(
        accessToken,
        "company_payout_reports",
        params,
        "Payout report version",
        signal,
        false,
      );
      const row = result.rows.at(0) ?? null;
      if (row) payoutMarketplace(row);
      return row;
    },
  };
}
