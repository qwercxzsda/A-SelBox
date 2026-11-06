import { useQuery } from "@tanstack/react-query";
import { fetchReportSourceTotals } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { RECONCILIATION_TOTAL_COLUMNS } from "./reconciliation-columns";
import { useDiagnosticsIdentity } from "./source-diagnostics-context";
import {
  buildSourceComparisons,
  requireReportDiagnosticScope,
  type ReportDiagnosticScope,
} from "./source-diagnostics";
import { Text } from "@mantine/core";

export function PayoutReconciliationTotals({
  accessToken,
  scope,
}: {
  accessToken: string;
  scope: ReportDiagnosticScope;
}) {
  const { report_id: reportId, currency } = scope;
  const identity = useDiagnosticsIdentity();
  const query = useQuery({
    queryKey: [
      "report-source-totals",
      identity.session.user.id,
      identity.account.access_role,
      identity.account.company_id,
      reportId,
      "total",
    ],
    queryFn: async ({ signal }) => {
      const result = await fetchReportSourceTotals(
        accessToken,
        { reportId, grouping: "total" },
        signal,
      );
      requireReportDiagnosticScope(result, scope);
      return buildSourceComparisons(result, "DATA_KIOSK");
    },
    staleTime: Infinity,
  });
  const rows = query.data ?? [];
  const label = "Account reconciliation totals";
  return (
    <DetailData
      query={query}
      label={label.toLowerCase()}
      rowCount={rows.length}
      emptyMessage="No account reconciliation for these report inputs."
    >
      {rows.some(
        (row) => row.finances_covered === "false" || row.data_kiosk_covered === "false",
      ) ? (
        <Text size="sm" c="dimmed">
          Retrieval coverage is incomplete. These are observed source amounts; unavailable
          counterparts are not zero.
        </Text>
      ) : null}
      {rows.length > 0 ? (
        <DetailTable
          label={label}
          columns={
            currency
              ? RECONCILIATION_TOTAL_COLUMNS.filter((column) => column.key !== "currency")
              : RECONCILIATION_TOTAL_COLUMNS
          }
          rows={rows}
          rowKey={(row) => row.currency ?? ""}
          minWidth={650}
        />
      ) : null}
    </DetailData>
  );
}
