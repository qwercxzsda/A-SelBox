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
  authoritative = true,
  pageKey,
}: {
  accessToken: string;
  reportId: string;
  currency: string;
  types?: string[];
  authoritative?: boolean;
  pageKey?: string;
}) {
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    pageKey ?? `payout:${reportId}:records:${JSON.stringify([authoritative, types])}`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: ["payout-records", reportId, authoritative, types, pageIndex],
    queryFn: ({ signal }) =>
      fetchPayoutRecords(accessToken, reportId, authoritative, pageIndex, signal, types),
    staleTime: Infinity,
  });
  return (
    <FinancialRecords
      query={query}
      pageIndex={pageIndex}
      onPageChange={setPageIndex}
      currency={currency}
      authoritative={authoritative}
      label={authoritative ? "Amount records" : "Supporting payout records"}
    />
  );
}
