import { useQuery } from "@tanstack/react-query";
import { fetchReportSourceTotals } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { RECONCILIATION_DETAIL_COLUMNS } from "./reconciliation-columns";
import { useWorkspacePreference } from "./use-workspace-preference";
import { decodeDetailPage } from "./detail-view-state";
import { useDiagnosticsIdentity } from "./source-diagnostics-context";
import {
  buildSourceComparisons,
  requireReportDiagnosticScope,
  type ReportDiagnosticScope,
} from "./source-diagnostics";

/** Administrator-only account controls never contribute again to a company payout. */
export function PayoutReconciliation({
  accessToken,
  scope,
}: {
  accessToken: string;
  scope: ReportDiagnosticScope;
}) {
  const { report_id: reportId, currency } = scope;
  const identity = useDiagnosticsIdentity();
  const [pageIndex, setPageIndex] = useWorkspacePreference(
    `payout:${reportId}:${currency ?? ""}:reconciliation-page`,
    () => 0,
    decodeDetailPage,
  );
  const query = useQuery({
    queryKey: [
      "report-source-totals",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      reportId,
      "day",
      pageIndex,
    ],
    queryFn: async ({ signal }) => {
      const result = await fetchReportSourceTotals(
        accessToken,
        { reportId, grouping: "day", pageIndex },
        signal,
      );
      requireReportDiagnosticScope(result, scope);
      return { rows: buildSourceComparisons(result, "DATA_KIOSK"), totalCount: result.totalCount };
    },
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  return (
    <DetailData
      query={query}
      label="reconciliation"
      rowCount={rows.length}
      emptyMessage="No reconciliation rows for these report inputs."
      pagination={{
        pageIndex,
        totalCount: query.data?.totalCount ?? null,
        onPageChange: setPageIndex,
      }}
    >
      {rows.length > 0 ? (
        <DetailTable
          label="Account reconciliation"
          columns={RECONCILIATION_DETAIL_COLUMNS}
          rows={rows}
          rowKey={(row) =>
            JSON.stringify([
              row.seller_namespace,
              row.activity_date,
              row.marketplace_name,
              row.currency,
            ])
          }
          minWidth={900}
        />
      ) : null}
    </DetailData>
  );
}
