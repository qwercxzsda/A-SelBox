import type { ReactNode, Ref } from "react";
import { Text, Title } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { PayoutReviewDetails } from "./PayoutReviewDetails";
import { PayoutAmounts } from "./PayoutAmounts";
import { AdditionalDetails } from "./AdditionalDetails";
import { formatRecordDate } from "./date-display";
import { recordMetadata } from "./record-metadata";
import { payoutMarketplaceLabel } from "./payout-report-scope";
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
  const columns: ColumnDefinition[] = displayColumns(dataset, isAdministrator)
    .flatMap(({ secondary, ...column }) => (secondary ? [column, secondary] : [column]))
    .filter((column) => !(column.key === "sku" && row.sku));
  const shown = new Set([...TABLE_COLUMNS[dataset], ...columns].map((column) => column.key));
  const remaining = Object.keys(row).filter((key) => key === "company_id" || !shown.has(key));
  return (
    <>
      <Title ref={headingRef} tabIndex={-1} order={3} mb={4} className="row-detail-title">
        {isReview ? "Saved report review" : (row.sku ?? DATASET_PRESENTATION[dataset].label)}
      </Title>
      <Text c="dimmed" size="sm" mb="lg">
        {dataset === "payouts"
          ? `${companies.get(row.company_id ?? "") ?? "Company"} · ${row.start_date ?? ""} – ${row.end_date ?? ""} · ${payoutMarketplaceLabel(row)}${row.currency ? ` · ${row.currency}` : ""}`
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
      {isAdministrator && remaining.length > 0 ? (
        <AdditionalDetails
          stateKey={`row:${dataset}:${rowId(row)}:metadata`}
          key={`audit-${rowId(row)}`}
          rows={recordMetadata(row, remaining)}
        />
      ) : null}
    </>
  );
}
