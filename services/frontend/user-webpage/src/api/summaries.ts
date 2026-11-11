import { decodeMarketplaceCurrencyTotals, decodeTypeTotals } from "./aggregates.ts";
import { companySelectionValues, requireDateRange, textSelectionValues } from "./filters.ts";
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
          "Current totals",
          signal,
        ),
      decodeRows,
      rowKey,
      "Current totals",
      signal,
    );
  }

  return {
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
        filters: {
          companyIds: [],
          skus: [],
          marketplaces: [],
          dateFrom: "",
          dateTo: "",
          sources: [],
          types: [],
          feeApplicability: [],
        },
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
      return readTransactionTotals(options, null, decodeMarketplaceCurrencyTotals, (row) =>
        JSON.stringify([row.marketplace, row.currency]),
      );
    },

    async fetchTransactionTypeTotals(
      options: FetchTransactionTypeTotalsOptions,
    ): Promise<TransactionTypeTotal[]> {
      const { currency } = options;
      requireCurrency(currency);
      return readTransactionTotals(
        options,
        currency,
        (rows) => decodeTypeTotals(rows, currency),
        (row) => JSON.stringify([row.currency, row.type]),
      );
    },
  };
}
