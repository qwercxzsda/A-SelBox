import "./RowDetail.css";
import { Fragment } from "react";
import { Drawer, Text, Title } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { humanizeCode } from "./categories";
import { PayoutComponents } from "./PayoutComponents";
import { PayoutReconciliation } from "./PayoutReconciliation";
import { PayoutMarketplaceTotals } from "./PayoutMarketplaceTotals";
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
}: {
  companies: Map<string, string>;
  dataset: TableDatasetKey;
  row: CanonicalRow | null;
  onClose: () => void;
  isAdministrator: boolean;
  accessToken: string;
}) {
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
      id="selected-row-details"
      opened={row !== null}
      onClose={onClose}
      position="right"
      size="lg"
      padding="lg"
      title="Selected row details"
      closeButtonProps={{ "aria-label": "Close row details" }}
    >
      {row ? (
        <>
          <Title order={3} mb={4}>
            {row.sku ?? DATASET_PRESENTATION[dataset].label}
          </Title>
          <Text c="dimmed" size="sm" mb="lg">
            Exact values for this record.
          </Text>
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
          {dataset === "payouts" && row.id ? (
            <Fragment key={row.id}>
              <PayoutMarketplaceTotals
                reportId={row.id}
                currency={row.currency ?? ""}
                accessToken={accessToken}
              />
              <PayoutComponents
                reportId={row.id}
                currency={row.currency ?? ""}
                accessToken={accessToken}
              />
              {isAdministrator && Number(row.reconciliation_count) > 0 ? (
                <PayoutReconciliation accessToken={accessToken} reportId={row.id} />
              ) : null}
            </Fragment>
          ) : null}
          {isAdministrator && remaining.length > 0 ? (
            <details className="audit-details" key={rowId(row)}>
              <summary>Additional details</summary>
              <div className="audit-grid">
                {remaining.map((key) => {
                  const column: ColumnDefinition = { key, kind: "text", label: humanizeCode(key) };
                  return (
                    <div className="audit-value" key={key}>
                      <span className="field-label">{column.label}</span>
                      <code>
                        <TableCellValue column={column} companies={companies} row={row} />
                      </code>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
