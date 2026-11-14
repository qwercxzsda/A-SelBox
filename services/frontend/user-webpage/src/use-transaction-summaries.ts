import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchLatestTransactionDate,
  fetchTransactionPeriodTotals,
  type MarketplaceCurrencyTotal,
} from "./api";
import {
  summaryPeriods,
  selectedPeriod,
  TOTALS_PERIOD_LABELS,
  type DateRange,
  type PeriodDefinition,
} from "./summary-periods";
import type { MarketplaceSummary, SummaryState } from "./summary-types";
import type { DatasetFilters, TransactionSummaryScope, TransactionSearchValues } from "./api/types";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";
import { normalizeDatasetFilters } from "./dataset-filters";
import { summaryMarketplaces, sortMarketplaceSummaries } from "./summary-marketplaces";
import { resolveTransactionSearch } from "./transaction-search";

function periodQueryOptions(
  identity: Identity,
  range: DateRange | null,
  scope: TransactionSummaryScope,
  searchValues: TransactionSearchValues | null,
) {
  const { session, account } = identity;
  return {
    queryKey: [
      "company-period-totals",
      session.user.id,
      account.access_role,
      account.company_id,
      scope,
      searchValues,
      range?.from,
      range?.to,
    ],
    enabled: range !== null,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (range === null) throw new Error("Select a period to load totals.");
      return fetchTransactionPeriodTotals({
        accessToken: session.access_token,
        dateFrom: range.from,
        dateTo: range.to,
        ...scope,
        searchValues,
        signal,
      });
    },
  };
}

function summaryState(
  definition: PeriodDefinition | null,
  query: UseQueryResult<MarketplaceCurrencyTotal[]>,
  title: string,
): SummaryState {
  return {
    definition,
    pending: definition !== null && query.isPending,
    error: query.error ? `${title}: ${getErrorMessage(query.error)}` : null,
  };
}

export function useTransactionSummaries(
  identity: Identity,
  filters: DatasetFilters,
  search: string,
) {
  const { session, account } = identity;
  const { dateFrom, dateTo, ...selections } = normalizeDatasetFilters(filters);
  const dateRange = { from: dateFrom, to: dateTo };
  const scope: TransactionSummaryScope = {
    ...selections,
    companyIds: account.access_role === "administrator" ? selections.companyIds : [],
    search: search.trim(),
  };
  const searchValues = resolveTransactionSearch(
    "live",
    account.access_role,
    identity.skuOptions,
    scope.search,
  );
  // The common calendar anchor follows account visibility, never UI filters.
  const latest = useQuery({
    queryKey: [
      "transaction-latest-utc-date",
      session.user.id,
      account.access_role,
      account.company_id,
    ],
    queryFn: ({ signal }) =>
      fetchLatestTransactionDate({ accessToken: session.access_token, signal }),
  });
  const periods = { ...summaryPeriods(latest.data ?? null), selected: selectedPeriod(dateRange) };
  const dayQuery = useQuery(
    periodQueryOptions(identity, periods.day?.range ?? null, scope, searchValues),
  );
  const monthQuery = useQuery(
    periodQueryOptions(identity, periods.month?.range ?? null, scope, searchValues),
  );
  const selectedQuery = useQuery(
    periodQueryOptions(identity, periods.selected?.range ?? null, scope, searchValues),
  );
  const discoveryError = latest.error
    ? `Latest transaction date: ${getErrorMessage(latest.error)}`
    : null;
  const states = {
    day: summaryState(periods.day, dayQuery, TOTALS_PERIOD_LABELS.day),
    month: summaryState(periods.month, monthQuery, TOTALS_PERIOD_LABELS.month),
    selected: summaryState(periods.selected, selectedQuery, TOTALS_PERIOD_LABELS.selected),
  };
  for (const period of ["day", "month"] as const) {
    states[period].pending ||= latest.isPending;
    states[period].error = discoveryError ?? states[period].error;
  }
  const groups: MarketplaceSummary[] = summaryMarketplaces(scope.marketplaces).map(
    (marketplace) => ({
      marketplace,
      day: periods.day
        ? (dayQuery.data ?? []).filter((total) => total.marketplace === marketplace)
        : [],
      month: periods.month
        ? (monthQuery.data ?? []).filter((total) => total.marketplace === marketplace)
        : [],
      selected: periods.selected
        ? (selectedQuery.data ?? []).filter((total) => total.marketplace === marketplace)
        : [],
    }),
  );
  return {
    scope,
    dateRange,
    groups: sortMarketplaceSummaries(groups),
    states,
    loading: [latest, dayQuery, monthQuery, selectedQuery].some((query) => query.isFetching),
  };
}
