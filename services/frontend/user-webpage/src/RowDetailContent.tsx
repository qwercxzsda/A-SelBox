import type { ReactNode } from "react";
import { Group, Text } from "@mantine/core";
import type { CanonicalRow, TableDatasetKey } from "./api";
import { TableCellValue } from "./Cell";
import { PayoutAmounts } from "./PayoutAmounts";
import { AdditionalDetails } from "./AdditionalDetails";
import { HelpPopover } from "./HelpPopover";
import { DetailFields } from "./DetailFields";
import { SkuTransactionLink } from "./SkuTransactionLink";
import { formatRecordDate } from "./date-display";
import { recordMetadata } from "./record-metadata";
import { TABLE_COLUMNS, displayColumns, type ColumnDefinition } from "./table-columns";
import { rowId } from "./view-model";

function recordColumns(dataset: TableDatasetKey, isAdministrator: boolean): ColumnDefinition[] {
  const columns = displayColumns(dataset, isAdministrator).flatMap(({ secondary, ...column }) =>
    secondary ? [column, secondary] : [column],
  );
  if (dataset === "live")
    columns.push(
      { key: "base_amount", label: "Base amount", kind: "money" },
      { key: "tax_amount", label: "Tax amount", kind: "money" },
    );
  return columns;
}

/** Render a loaded record independently of drawer loading and focus recovery. */
export function RowDetailContent({
  companies,
  dataset,
  row,
  isAdministrator,
  accessToken,
  reportNavigation,
  onShowTransactions,
}: {
  companies: Map<string, string>;
  dataset: TableDatasetKey;
  row: CanonicalRow;
  isAdministrator: boolean;
  accessToken: string;
  reportNavigation?: ReactNode;
  onShowTransactions?: (sku: string) => void;
}) {
  const columns = recordColumns(dataset, isAdministrator);
  const shown = new Set([...TABLE_COLUMNS[dataset], ...columns].map((column) => column.key));
  const remaining = Object.keys(row).filter((key) => key === "company_id" || !shown.has(key));
  return (
    <>
      {dataset === "finances" && row.activity_eligible === "false" ? (
        <Group gap={6} wrap="nowrap" mb="lg">
          <Text size="sm" c="dimmed">
            Not counted as activity.
          </Text>
          <HelpPopover label="Activity help">
            Linked releases and bank transfers move funds already counted. A released status alone
            does not exclude a directly posted fee.
          </HelpPopover>
        </Group>
      ) : null}
      {dataset === "payouts" ? (
        <>
          {row.created_at ? (
            <Text size="xs" c="dimmed" mb="sm">
              Saved report · Created {formatRecordDate(row.created_at)}
            </Text>
          ) : null}
          {reportNavigation}
          {row.id ? (
            <PayoutAmounts key={`payout-${row.id}`} row={row} accessToken={accessToken} />
          ) : null}
        </>
      ) : (
        <DetailFields
          fields={columns.map((column) => ({
            key: column.key,
            label: column.label,
            value:
              column.key === "sku" && row.sku && onShowTransactions ? (
                <SkuTransactionLink sku={row.sku} onShowTransactions={onShowTransactions} />
              ) : (
                <TableCellValue column={column} companies={companies} row={row} />
              ),
          }))}
        />
      )}
      {isAdministrator && remaining.length > 0 ? (
        <AdditionalDetails
          stateKey={`row:${dataset}:${rowId(row)}:metadata`}
          key={`audit-${rowId(row)}`}
          rows={recordMetadata(row, remaining, { exactAmounts: dataset === "finances" })}
        />
      ) : null}
    </>
  );
}
