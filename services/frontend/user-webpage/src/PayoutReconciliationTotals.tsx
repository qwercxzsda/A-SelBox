import type { UseQueryResult } from "@tanstack/react-query";
import type { CanonicalRow } from "./api";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { RECONCILIATION_TOTAL_COLUMNS } from "./reconciliation-columns";

export function PayoutReconciliationTotals({
  query,
  currency,
}: {
  query: UseQueryResult<CanonicalRow[]>;
  currency: string | null;
}) {
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
