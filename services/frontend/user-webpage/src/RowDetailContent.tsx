import type { ReactNode, Ref } from "react";
import { Text, Title } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { humanizeCode } from "./categories";
import { PayoutReviewDetails } from "./PayoutReviewDetails";
import { PayoutAmounts } from "./PayoutAmounts";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { formatRecordDate } from "./date-display";
import { formatAmount } from "./decimal";
import {
  DATASET_PRESENTATION,
  TABLE_COLUMNS,
  displayColumns,
  rowId,
  type ColumnDefinition,
} from "./view-model";

/** Render a loaded record independently of drawer loading and focus recovery. */
export function RowDetailContent({
  companies,
  dataset,
  row,
  isAdministrator,
  accessToken,
  isReview,
  reportNavigation,
  headingRef,
}: {
  companies: Map<string, string>;
  dataset: TableDatasetKey;
  row: CanonicalRow;
  isAdministrator: boolean;
  accessToken: string;
  isReview: boolean;
  reportNavigation?: ReactNode;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const columns: ColumnDefinition[] = [
    ...displayColumns(dataset, isAdministrator).filter(
      (column) => !(column.key === "sku" && row.sku),
    ),
    ...(isAdministrator && row.seller_namespace
      ? [{ key: "seller_namespace", kind: "text" as const, label: "Source namespace" }]
      : []),
  ];
  const shown = new Set([...TABLE_COLUMNS[dataset], ...columns].map((column) => column.key));
  const remaining = Object.keys(row).filter((key) => !shown.has(key));
  return (
    <>
      <Title ref={headingRef} tabIndex={-1} order={3} mb={4} className="row-detail-title">
        {isReview ? "Saved report review" : (row.sku ?? DATASET_PRESENTATION[dataset].label)}
      </Title>
      <Text c="dimmed" size="sm" mb="lg">
        {dataset === "payouts"
          ? `${companies.get(row.company_id ?? "") ?? "Company"} · ${row.start_date ?? ""} – ${row.end_date ?? ""}${row.currency ? ` · ${row.currency}` : ""}`
          : "Details for this record."}
      </Text>
      {dataset === "finances" && row.activity_eligible === "false" ? (
        <Text size="sm" c="dimmed" mb="lg">
          This record is exclusive of activity totals. Linked releases track when existing funds
          become available; transfers track movement to or from a bank account. The original
          economic activity is counted once. A released status alone does not exclude a directly
          posted fee.
        </Text>
      ) : null}
      {dataset === "payouts" && row.created_at ? (
        <Text size="xs" c="dimmed" mt={-12} mb="lg">
          Saved report · Created {formatRecordDate(row.created_at)}
        </Text>
      ) : null}
      {dataset === "payouts" ? reportNavigation : null}
      {dataset !== "payouts" ? (
        <div className="detail-grid">
          {columns.map((column) => (
            <div className="detail-field" key={column.key}>
              <span className="field-label">{column.label}</span>
              <span className="field-value">
                <TableCellValue column={column} companies={companies} row={row} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {dataset === "payouts" && row.id && isReview ? (
        <PayoutReviewDetails key={`review-${row.id}`} row={row} accessToken={accessToken} />
      ) : dataset === "payouts" && row.id ? (
        <PayoutAmounts key={`payout-${row.id}`} row={row} accessToken={accessToken} />
      ) : null}
      {isAdministrator && remaining.length > 0 && (dataset !== "payouts" || isReview) ? (
        <DetailSection
          stateKey={`row:${dataset}:${rowId(row)}:metadata`}
          title="Additional details"
          collapsible
          key={`audit-${rowId(row)}`}
          description="Saved identifiers and processing metadata for this record."
        >
          <DetailTable
            label="Additional record details"
            columns={[
              { key: "field", label: "Field" },
              { key: "value", label: "Value" },
            ]}
            rows={remaining.map((key) => ({
              field: humanizeCode(key),
              value: key === "fee_base" ? formatAmount(row[key]) : row[key],
            }))}
            rowKey={(record) => record.field ?? ""}
            minWidth={0}
          />
        </DetailSection>
      ) : null}
    </>
  );
}
