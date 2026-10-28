import { useQuery } from "@tanstack/react-query";
import { fetchPayoutReconciliationTotals } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { RECONCILIATION_TOTAL_COLUMNS } from "./reconciliation-columns";

export function PayoutReconciliationTotals({
  accessToken,
  reportId,
  currency,
}: {
  accessToken: string;
  reportId: string;
  currency: string | null;
}) {
  const query = useQuery({
    queryKey: ["payout-reconciliation-totals", reportId, currency],
    queryFn: ({ signal }) =>
      fetchPayoutReconciliationTotals(accessToken, reportId, signal, currency ?? undefined),
    staleTime: Infinity,
  });
  const rows = query.data ?? [];
  const label = "Saved account reconciliation totals";
  return (
    <DetailData
      query={query}
      label={label.toLowerCase()}
      rowCount={rows.length}
      emptyMessage="No saved account reconciliation."
    >
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
