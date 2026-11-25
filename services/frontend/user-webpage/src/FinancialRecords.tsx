import type { UseQueryResult } from "@tanstack/react-query";
import type { PageResult } from "./api/types";
import { DetailData } from "./DetailData";
import { DetailTable } from "./DetailTable";
import { financialAmountColumns, type DetailColumn } from "./detail-columns";
import { TransactionTime } from "./TransactionTime";

const RECORD_COLUMNS: DetailColumn[] = [
  { key: "activity_date", label: "Date", kind: "date" },
  { key: "sku", label: "SKU" },
  { key: "marketplace_name", label: "Marketplace", empty: "Not specified", nowrap: true },
  { key: "source", label: "Source", kind: "source" },
  { key: "component_type", label: "Type", kind: "type" },
  { key: "quantity", label: "Quantity", kind: "number" },
  { key: "base_amount", label: "Base amount", kind: "amount" },
  { key: "tax_amount", label: "Tax amount", kind: "amount" },
];

export function FinancialRecords({
  query,
  pageIndex,
  onPageChange,
  currency,
  label = "Amount records",
  transactionTimeline = false,
}: {
  query: UseQueryResult<PageResult>;
  pageIndex: number;
  onPageChange: (page: number) => void;
  currency: string;
  label?: string;
  transactionTimeline?: boolean;
}) {
  const rows = query.data?.rows ?? [];
  return (
    <DetailData
      query={query}
      label="records"
      rowCount={rows.length}
      emptyMessage="No matching records"
      pagination={{ pageIndex, totalCount: query.data?.totalCount ?? null, onPageChange }}
    >
      {rows.length > 0 ? (
        <DetailTable
          label={label}
          columns={[
            ...RECORD_COLUMNS.map((column) =>
              transactionTimeline && column.key === "activity_date"
                ? { ...column, key: "activity_at", label: "Date (UTC)" }
                : column,
            ),
            ...financialAmountColumns(currency),
          ]}
          rows={rows}
          rowKey={(row) => [row.report_id, row.source, row.source_row_id].filter(Boolean).join(":")}
          renderCell={
            transactionTimeline
              ? (row, column) =>
                  column.key === "activity_at" ? <TransactionTime row={row} /> : undefined
              : undefined
          }
        />
      ) : null}
    </DetailData>
  );
}
