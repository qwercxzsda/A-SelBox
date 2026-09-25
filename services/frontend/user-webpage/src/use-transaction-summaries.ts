import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchLatestTransactionDate,
  fetchTransactionPeriodTotals,
  type CurrencyTotal,
  type DatasetFilters,
} from "./api";
import {
  summaryPeriods,
  selectedPeriod,
  type DateRange,
  type PeriodDefinition,
} from "./estimated-periods";
import type { SummaryState } from "./summary-types";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";
import { normalizeSelections } from "./dataset-filters";

export type TransactionSummaryScope = Pick<DatasetFilters, "companyIds" | "skus" | "marketplaces">;

function usePeriodTotals(
  identity: Identity,
  period: PeriodDefinition | null,
  scope: TransactionSummaryScope,
) {
  const { session, account } = identity;
  return useQuery({
    queryKey: [
      "transaction-period-totals",
      session.user.id,
      account.access_role,
      account.company_id,
      scope,
      period?.range.from,
      period?.range.to,
    ],
    enabled: period !== null,
    queryFn: ({ signal }) => {
      if (period === null) throw new Error("Select a period to load totals.");
      return fetchTransactionPeriodTotals({
        accessToken: session.access_token,
        dateFrom: period.range.from,
        dateTo: period.range.to,
        ...scope,
        signal,
      });
    },
  });
}

function summaryState(
  period: PeriodDefinition | null,
  query: UseQueryResult<CurrencyTotal[]>,
  title: string,
): SummaryState {
  return {
    period: period && query.data !== undefined ? { ...period, totals: query.data } : null,
    pending: period !== null && query.isPending,
    error: query.error ? `${title}: ${getErrorMessage(query.error)}` : null,
  };
}

export function useTransactionSummaries(
  identity: Identity,
  dateRange: DateRange,
  filters: TransactionSummaryScope,
) {
  const { session, account } = identity;
  const scope: TransactionSummaryScope = {
    companyIds: account.access_role === "operator" ? normalizeSelections(filters.companyIds) : [],
    skus: normalizeSelections(filters.skus),
    marketplaces: normalizeSelections(filters.marketplaces),
  };
  const latest = useQuery({
    queryKey: [
      "transaction-latest-date",
      session.user.id,
      account.access_role,
      account.company_id,
      scope,
    ],
    queryFn: ({ signal }) =>
      fetchLatestTransactionDate({ accessToken: session.access_token, signal, ...scope }),
  });
  const periods = summaryPeriods(latest.data ?? null);
  const selected = selectedPeriod(dateRange);
  const dayQuery = usePeriodTotals(identity, periods.day, scope);
  const monthQuery = usePeriodTotals(identity, periods.month, scope);
  const selectedQuery = usePeriodTotals(identity, selected, scope);
  const day = summaryState(periods.day, dayQuery, "Latest day");
  const month = summaryState(periods.month, monthQuery, "Latest month");
  const discoveryError = latest.error
    ? `Latest transaction date: ${getErrorMessage(latest.error)}`
    : null;
  return {
    scope,
    day: { ...day, pending: latest.isPending || day.pending, error: discoveryError ?? day.error },
    month: {
      ...month,
      pending: latest.isPending || month.pending,
      error: discoveryError ?? month.error,
    },
    selected: summaryState(selected, selectedQuery, "Selected dates"),
    selectionActive: selected !== null,
    loading: [latest, dayQuery, monthQuery, selectedQuery].some((query) => query.isFetching),
  };
}
