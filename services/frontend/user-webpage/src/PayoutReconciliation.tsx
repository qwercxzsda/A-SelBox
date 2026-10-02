import { useQuery } from "@tanstack/react-query";
import { fetchPayoutReconciliation } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { RECONCILIATION_DETAIL_COLUMNS } from "./reconciliation-columns";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";

/** Administrator-only account controls never contribute again to a company payout. */
export function PayoutReconciliation({
  accessToken,
  reportId,
}: {
  accessToken: string;
  reportId: string;
}) {
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `payout:${reportId}:reconciliation-page`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: ["payout-reconciliation", reportId, pageIndex],
    queryFn: ({ signal }) => fetchPayoutReconciliation(accessToken, reportId, pageIndex, signal),
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <DetailData
      query={query}
      label="reconciliation"
      rowCount={rows.length}
      emptyMessage="No saved reconciliation rows."
      pagination={{
        pageIndex,
        totalCount: query.data?.totalCount ?? null,
        onPageChange: setPageIndex,
      }}
    >
      {rows.length > 0 ? (
        <DetailTable
          label="Saved reconciliation"
          columns={RECONCILIATION_DETAIL_COLUMNS}
          rows={rows}
          rowKey={(row) => row.row_number ?? ""}
          minWidth={1300}
        />
      ) : null}
    </DetailData>
  );
}
