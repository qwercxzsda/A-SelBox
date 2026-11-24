import { useQuery } from "@tanstack/react-query";
import { fetchPayoutRecords } from "./api";
import { FinancialRecords } from "./FinancialRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";

export function PayoutComponents({
  accessToken,
  reportId,
  currency,
  types = [],
  pageKey,
}: {
  accessToken: string;
  reportId: string;
  currency: string;
  types?: string[];
  pageKey?: string;
}) {
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    pageKey ?? `payout:${reportId}:records:${JSON.stringify(types)}`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: ["payout-records", reportId, types, pageIndex],
    queryFn: ({ signal }) => fetchPayoutRecords(accessToken, reportId, pageIndex, signal, types),
    staleTime: Infinity,
  });
  return (
    <FinancialRecords
      query={query}
      pageIndex={pageIndex}
      onPageChange={setPageIndex}
      currency={currency}
      label="Amount records"
    />
  );
}
