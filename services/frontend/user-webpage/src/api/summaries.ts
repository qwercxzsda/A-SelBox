import {
  decodeMarketplaceCurrencyTotals,
  decodeTypeTotals,
  decodeTransactionTrends,
} from "./aggregates.ts";
import { transactionFilterArguments } from "./transaction-page.ts";
import { LOOKUP_PAGE_SIZE } from "./pagination.ts";
import { readOffsetRpcRows } from "./rpc-pagination.ts";
import { requireAccessToken, type ApiTransport } from "./transport.ts";
import { requireCurrency } from "./validation.ts";
import { parseRecordTimestamp } from "../date-display.ts";
import type {
  MarketplaceCurrencyTotal,
  TransactionTypeTotal,
  FetchLatestTransactionDateOptions,
  FetchDatasetPageOptions,
  PageResult,
  FetchTransactionPeriodTotalsOptions,
  FetchTransactionTypeTotalsOptions,
  FetchTransactionTrendsOptions,
  TransactionTrendTotal,
  TransactionTrendGranularity,
} from "./types.ts";

type TotalGrouping =
  | { p_currency: string | null; p_group_by_type: boolean }
  | { p_granularity: TransactionTrendGranularity };

function buildPeriodArguments(options: FetchTransactionPeriodTotalsOptions) {
  const { dateFrom, dateTo } = options;
  if (!dateFrom && !dateTo) throw new Error("At least one date bound is required");
  return transactionFilterArguments({
    accessToken: options.accessToken,
    dataset: "live",
    search: options.search,
    searchValues: options.searchValues,
    filters: options,
  });
}

export function createSummaryApi(
  { postRpc }: ApiTransport,
  fetchDatasetPage: (options: FetchDatasetPageOptions) => Promise<PageResult>,
) {
  async function readTransactionTotals<Row>(
    options: FetchTransactionPeriodTotalsOptions,
    grouping: TotalGrouping,
    decodeRows: (rows: unknown[]) => Row[],
    rowKey: (row: Row) => string,
    operation = "Current totals",
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
            ...grouping,
            p_limit: LOOKUP_PAGE_SIZE,
            p_offset: offset,
          },
          operation,
          signal,
        ),
      decodeRows,
      rowKey,
      operation,
      signal,
    );
  }

  return {
    async fetchTransactionTrends(
      options: FetchTransactionTrendsOptions,
    ): Promise<TransactionTrendTotal[]> {
      const { granularity } = options;
      if (!["day", "week"].includes(granularity)) throw new Error("Choose daily or weekly trends");
      return readTransactionTotals(
        options,
        { p_granularity: granularity },
        (rows) => decodeTransactionTrends(rows, granularity),
        (row) => JSON.stringify([row.periodStart, row.marketplace, row.currency, row.type]),
        "Transaction trends",
      );
    },

    async fetchLatestTransactionDate({
      accessToken,
      signal,
    }: FetchLatestTransactionDateOptions): Promise<string | null> {
      const { rows } = await fetchDatasetPage({
        accessToken,
        signal,
        dataset: "live",
        pageIndex: 0,
        pageSize: 1,
        search: "",
        sort: { column: "activity_at", direction: "desc" },
        includeCount: false,
      });
      if (rows.length === 0) return null;
      if (rows.length !== 1) throw new Error("Latest transaction date returned multiple rows");
      const value = rows[0].activity_at;
      const timestamp = typeof value === "string" ? parseRecordTimestamp(value) : null;
      if (timestamp === null)
        throw new Error("Latest transaction date returned an invalid timestamp");
      return timestamp.toISOString().slice(0, 10);
    },

    async fetchTransactionPeriodTotals(
      options: FetchTransactionPeriodTotalsOptions,
    ): Promise<MarketplaceCurrencyTotal[]> {
      return readTransactionTotals(
        options,
        { p_currency: null, p_group_by_type: false },
        decodeMarketplaceCurrencyTotals,
        (row) => JSON.stringify([row.marketplace, row.currency]),
      );
    },

    async fetchTransactionTypeTotals(
      options: FetchTransactionTypeTotalsOptions,
    ): Promise<TransactionTypeTotal[]> {
      const { currency } = options;
      requireCurrency(currency);
      return readTransactionTotals(
        options,
        { p_currency: currency, p_group_by_type: true },
        (rows) => decodeTypeTotals(rows, currency),
        (row) => JSON.stringify([row.currency, row.type]),
      );
    },
  };
}
