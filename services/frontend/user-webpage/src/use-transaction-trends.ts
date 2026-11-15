import { useQuery } from "@tanstack/react-query";
import { fetchTransactionTrends } from "./api";
import type { Identity } from "./auth-session";
import type { TransactionSummaryScope, TransactionTrendGranularity } from "./api/types";
import type { DateRange } from "./summary-periods";
import { transactionTrendPeriod } from "./transaction-trend-periods";
import { resolveTransactionSearch } from "./transaction-search";
import { getErrorMessage } from "./view-model";

export function useTransactionTrends(
  identity: Identity,
  scope: TransactionSummaryScope,
  dateRange: DateRange,
  latestDate: string | null,
  granularity: TransactionTrendGranularity | null,
) {
  const { session, account } = identity;
  const definition = granularity
    ? transactionTrendPeriod(latestDate, granularity, dateRange)
    : null;
  const searchValues = resolveTransactionSearch(
    "live",
    account.access_role,
    identity.skuOptions,
    scope.search,
  );
  const query = useQuery({
    queryKey: [
      "transaction-trends",
      session.user.id,
      account.access_role,
      account.company_id,
      scope,
      searchValues,
      granularity,
      definition?.range,
    ],
    enabled: definition !== null && granularity !== null,
    queryFn: ({ signal }) => {
      if (!definition || !granularity) throw new Error("Select a period to load trends.");
      return fetchTransactionTrends({
        accessToken: session.access_token,
        ...scope,
        dateFrom: definition.range.from,
        dateTo: definition.range.to,
        searchValues,
        granularity,
        signal,
      });
    },
  });
  return {
    definition,
    rows: query.data ?? [],
    pending: definition !== null && query.isPending,
    loading: query.isFetching,
    error: query.error ? getErrorMessage(query.error) : null,
  };
}
