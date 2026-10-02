import "./RowDetail.css";
import { Fragment, type ReactNode } from "react";
import { Drawer, Text, Title } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { humanizeCode } from "./categories";
import { PayoutReviewDetails } from "./PayoutReviewDetails";
import { PayoutMarketplaceTotals } from "./PayoutMarketplaceTotals";
import { PayoutAmounts } from "./PayoutAmounts";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { formatRecordDate } from "./date-display";
import {
  DATASET_PRESENTATION,
  TABLE_COLUMNS,
  displayColumns,
  rowId,
  type ColumnDefinition,
} from "./view-model";

export function RowDetail({
  companies,
  dataset,
  row,
  onClose,
  isAdministrator,
  accessToken,
  reviewMode = false,
  reportNavigation,
  stackId,
  onExitTransitionEnd,
}: {
  companies: Map<string, string>;
  dataset: TableDatasetKey;
  row: CanonicalRow | null;
  onClose: () => void;
  isAdministrator: boolean;
  accessToken: string;
  reviewMode?: boolean;
  reportNavigation?: ReactNode;
  stackId?: string;
  onExitTransitionEnd?: () => void;
}) {
  const isReview = dataset === "payouts" && reviewMode && isAdministrator;
  const columns: ColumnDefinition[] = [
    ...displayColumns(dataset, isAdministrator).filter(
      (column) => !(column.key === "sku" && row?.sku),
    ),
    ...(isAdministrator && row?.seller_namespace
      ? [{ key: "seller_namespace", kind: "text" as const, label: "Source namespace" }]
      : []),
  ];
  const shown = new Set([...TABLE_COLUMNS[dataset], ...columns].map((column) => column.key));
  const remaining = Object.keys(row ?? {}).filter((key) => !shown.has(key));
  return (
    <Drawer
      stackId={stackId}
      onExitTransitionEnd={onExitTransitionEnd}
      id="selected-row-details"
      opened={row !== null}
      onClose={onClose}
      position="right"
      size={dataset === "payouts" ? "min(1440px, 100vw)" : "lg"}
      padding="lg"
      title={isReview ? "Saved source details" : "Selected row details"}
      closeButtonProps={{ "aria-label": "Close row details" }}
    >
      {row ? (
        <>
          <Title order={3} mb={4}>
            {isReview ? "Saved report review" : (row.sku ?? DATASET_PRESENTATION[dataset].label)}
          </Title>
          <Text c="dimmed" size="sm" mb="lg">
            {dataset === "payouts"
              ? `${companies.get(row.company_id ?? "") ?? "Company"} · ${row.start_date ?? ""} – ${row.end_date ?? ""}${row.currency ? ` · ${row.currency}` : ""}`
              : "Exact values for this record."}
          </Text>
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
            <Fragment key={`payout-${row.id}`}>
              <PayoutAmounts row={row} accessToken={accessToken} />
              <DetailSection
                stateKey={`payout:${row.id}:marketplaces`}
                title="Marketplace breakdown"
                collapsible
                description="Reported amount, service fee, and company amount by marketplace."
              >
                <PayoutMarketplaceTotals
                  reportId={row.id}
                  currency={row.currency ?? ""}
                  accessToken={accessToken}
                />
              </DetailSection>
            </Fragment>
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
                rows={remaining.map((key) => ({ field: humanizeCode(key), value: row[key] }))}
                rowKey={(record) => record.field ?? ""}
                minWidth={0}
              />
            </DetailSection>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
