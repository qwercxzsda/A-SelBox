import { useQuery } from "@tanstack/react-query";
import { fetchDatasetPage } from "./api";
import type { Identity } from "./auth-session";
import type { DateRange } from "./summary-periods";
import type { TransactionSummaryScope } from "./api/types";
import { FinancialRecords } from "./FinancialRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";
import { DETAIL_PAGE_SIZE } from "./api/pagination";
import { resolveTransactionSearch } from "./transaction-search";

export function SummaryRecords({
  identity,
  range,
  scope,
  currency,
  types,
  stateKey,
}: {
  identity: Identity;
  range: DateRange;
  scope: TransactionSummaryScope;
  currency: string;
  types: string[];
  stateKey: string;
}) {
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `${stateKey}:records-page:${JSON.stringify(types)}`,
    () => 0,
    decodeDetailPage,
  );
  const searchValues = resolveTransactionSearch(
    "live",
    identity.account.access_role,
    identity.skuOptions,
    scope.search,
  );
  // A group/type drilldown can only narrow the filters captured by its total.
  const selectedTypes =
    types.length === 0
      ? scope.types
      : types.filter((type) => scope.types.length === 0 || scope.types.includes(type));
  const query = useQuery({
    queryKey: [
      "company-summary-records",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      scope,
      range,
      currency,
      types,
      searchValues,
      pageIndex,
    ],
    queryFn: async ({ signal }) => {
      if (types.length > 0 && selectedTypes.length === 0) return { rows: [], totalCount: 0 };
      return fetchDatasetPage({
        accessToken: identity.session.access_token,
        signal,
        dataset: "live",
        pageIndex,
        pageSize: DETAIL_PAGE_SIZE,
        search: scope.search,
        searchValues,
        sort: { column: "activity_at", direction: "desc" },
        currency,
        filters: {
          ...scope,
          dateFrom: range.from,
          dateTo: range.to,
          types: selectedTypes,
        },
      });
    },
  });
  return (
    <FinancialRecords
      query={query}
      pageIndex={pageIndex}
      onPageChange={setPageIndex}
      currency={currency}
      transactionTimeline
    />
  );
}
