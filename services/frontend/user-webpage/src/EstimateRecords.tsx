import { useQuery } from "@tanstack/react-query";
import { fetchDatasetPage } from "./api";
import type { Identity } from "./auth-session";
import type { DateRange } from "./estimated-periods";
import type { TransactionSummaryScope } from "./use-transaction-summaries";
import { FinancialRecords } from "./FinancialRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";
import { DETAIL_PAGE_SIZE } from "./api/pagination";

export function EstimateRecords({
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
  const query = useQuery({
    queryKey: [
      "transaction-summary-records",
      identity.session.user.id,
      scope,
      range,
      currency,
      types,
      pageIndex,
    ],
    queryFn: ({ signal }) =>
      fetchDatasetPage({
        accessToken: identity.session.access_token,
        signal,
        dataset: "live",
        pageIndex,
        pageSize: DETAIL_PAGE_SIZE,
        search: "",
        sort: { column: "activity_date", direction: "desc" },
        currency,
        filters: {
          ...scope,
          dateFrom: range.from,
          dateTo: range.to,
          sources: [],
          types,
          feeApplicability: [],
        },
      }),
  });
  return (
    <FinancialRecords
      query={query}
      pageIndex={pageIndex}
      onPageChange={setPageIndex}
      currency={currency}
    />
  );
}
