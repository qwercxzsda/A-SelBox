import { decodeCurrencyTotals, decodeTypeTotals } from "./aggregates.ts";
import {
  companySelectionValues,
  requireCalendarDate,
  requireDateRange,
  textSelectionValues,
} from "./filters.ts";
import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import { readOffsetRpcRows } from "./rpc-pagination.ts";
import { requireAccessToken, type ApiTransport } from "./transport.ts";
import type {
  CurrencyTotal,
  TransactionTypeTotal,
  FetchDatasetPageOptions,
  PageResult,
  FetchLatestTransactionDateOptions,
  FetchTransactionPeriodTotalsOptions,
  FetchTransactionTypeTotalsOptions,
} from "./types.ts";

function buildPeriodArguments(options: FetchTransactionPeriodTotalsOptions) {
  const { dateFrom, dateTo } = options;
  if (!dateFrom && !dateTo) throw new Error("At least one date bound is required");
  requireDateRange(dateFrom, dateTo);
  return {
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_company_ids: companySelectionValues(options.companyIds),
    p_skus: textSelectionValues("sku", options.skus).sort(),
    p_marketplaces: textSelectionValues("marketplace_name", options.marketplaces).sort(),
  };
}

export function createSummaryApi(
  { postRpc }: ApiTransport,
  fetchDatasetPage: (options: FetchDatasetPageOptions) => Promise<PageResult>,
) {
  async function readTransactionTotals<Row>(
    options: FetchTransactionPeriodTotalsOptions,
    currency: string | null,
    decodeRows: (rows: unknown[]) => Row[],
    rowKey: (row: Row) => string,
  ): Promise<Row[]> {
    const { accessToken, signal } = options;
    requireAccessToken(accessToken);
    const args = buildPeriodArguments(options);
    return readOffsetRpcRows(
      (offset) =>
        postRpc(
          accessToken,
          "transaction_totals",
          {
            ...args,
            p_currency: currency,
            p_group_by_type: currency !== null,
            p_limit: LOOKUP_PAGE_SIZE,
            p_offset: offset,
          },
          "Estimated totals",
          signal,
        ),
      decodeRows,
      rowKey,
      "Estimated totals",
      signal,
    );
  }

  return {
    async fetchLatestTransactionDate(
      options: FetchLatestTransactionDateOptions,
    ): Promise<string | null> {
      const { accessToken, signal, companyIds = [], skus = [], marketplaces = [] } = options;
      const { rows } = await fetchDatasetPage({
        accessToken,
        signal,
        dataset: "live",
        pageIndex: 0,
        pageSize: 1,
        search: "",
        sort: { column: "activity_date", direction: "desc" },
        filters: {
          companyIds,
          skus,
          marketplaces,
          dateFrom: "",
          dateTo: "",
          sources: [],
          types: [],
          feeApplicability: [],
        },
        includeCount: false,
      });
      if (rows.length === 0) return null;
      if (rows.length !== 1) throw new Error("Latest transaction date returned multiple rows");
      const date = rows[0].activity_date;
      // Date ordering puts NULL last; an all-undated scope has no latest calendar date.
      if (date === null) return null;
      try {
        if (typeof date !== "string") throw new Error("Missing date");
        requireCalendarDate(date);
      } catch {
        throw new Error("Latest transaction date returned an invalid date");
      }
      return date;
    },

    async fetchTransactionPeriodTotals(
      options: FetchTransactionPeriodTotalsOptions,
    ): Promise<CurrencyTotal[]> {
      return readTransactionTotals(options, null, decodeCurrencyTotals, (row) => row.currency);
    },

    async fetchTransactionTypeTotals(
      options: FetchTransactionTypeTotalsOptions,
    ): Promise<TransactionTypeTotal[]> {
      const { currency } = options;
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
        throw new Error("A valid currency code is required");
      return readTransactionTotals(
        options,
        currency,
        (rows) => decodeTypeTotals(rows, currency),
        (row) => JSON.stringify([row.currency, row.type]),
      );
    },
  };
}
