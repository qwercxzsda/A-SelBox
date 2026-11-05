import { DATASET_CONFIG } from "./config.ts";
import { requireCalendarDate } from "./filters.ts";
import { DETAIL_PAGE_SIZE, validatePagination } from "./pagination.ts";
import type { ApiTransport } from "./transport.ts";
import type { CanonicalRow, PageResult } from "./types.ts";
import { requireCurrency, requireUuid } from "./validation.ts";
import { isPayoutMarketplace, payoutMarketplace } from "../payout-report-scope.ts";

interface PayoutScopeOptions {
  marketplaceName: string | null;
  accessToken: string;
  companyId: string;
  startDate: string;
  endDate: string;
  currency: string | null;
  signal?: AbortSignal;
}

export interface FetchPayoutHistoryOptions extends PayoutScopeOptions {
  pageIndex: number;
}

export interface FetchPayoutVersionOptions extends PayoutScopeOptions {
  reportId: string;
}

function payoutScopeParams({
  companyId,
  startDate,
  endDate,
  currency,
  marketplaceName,
}: PayoutScopeOptions): URLSearchParams {
  requireUuid(companyId, "company");
  requireCalendarDate(startDate);
  requireCalendarDate(endDate);
  if (startDate > endDate) throw new Error("The start date must be on or before the end date");
  if (currency !== null) requireCurrency(currency);
  if (!isPayoutMarketplace(marketplaceName))
    throw new Error("Choose a valid payout report marketplace");
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
