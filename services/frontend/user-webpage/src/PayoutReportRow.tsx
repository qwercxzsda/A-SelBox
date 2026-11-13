import type { ReactNode } from "react";
import { Badge, Group, Table } from "@mantine/core";
import type { CanonicalRow } from "./api";
import type { ColumnDefinition } from "./view-model";
import { TableCellValue } from "./Cell";
import { inspectableRowProps } from "./inspectable-row";
import { payoutMarketplaceLabel } from "./payout-report-scope";
import { formatRecordDate } from "./date-display";
import { LoadingStatus } from "./LoadingStatus";
import { TableDisclosure } from "./TableDisclosure";

/** Latest and previous versions share the main report table's exact column structure. */
export function PayoutReportRow({
  row,
  columns,
  companies,
  selected,
  onSelect,
  scopeKey,
  label,
  children,
  history,
}: {
  row: CanonicalRow;
  columns: readonly ColumnDefinition[];
  companies: Map<string, string>;
  selected: boolean;
  onSelect: () => void;
  scopeKey: string;
  label: string;
  children?: ReactNode;
  history?: { expanded: boolean; updating: boolean; rowSpan: number; onToggle: () => void };
}) {
  const latest = history !== undefined;
  return (
    <Table.Tr
      {...inspectableRowProps(selected, onSelect)}
      className={`inspectable-row ${latest ? "payout-latest-row" : "payout-version-row"}`}
      data-version={latest ? "latest" : "previous"}
      data-scope={scopeKey}
      aria-label={
        latest
          ? undefined
          : `Previous version for ${label}, saved ${formatRecordDate(row.created_at ?? "")}`
      }
    >
      {children}
      {columns.map((column) => {
        const sharedContext = column.key === "company_id" || column.key === "marketplace_name";
        return (
          <Table.Td
            key={column.key}
            data-column={column.key}
            rowSpan={sharedContext ? history?.rowSpan : undefined}
            className={
              sharedContext ? "payout-scope-cell" : column.align === "right" ? "numeric" : undefined
            }
          >
            {column.key === "created_at" ? (
              <div className="payout-report-updated">
                <Badge
                  size="xs"
                  variant="light"
                  color={latest ? "teal" : "gray"}
                  c={latest ? "#065f46" : undefined}
                  title={latest ? "Newest saved version" : undefined}
                >
                  {latest ? "Latest" : "Previous"}
                </Badge>
                <TableCellValue column={column} row={row} companies={companies} />
              </div>
            ) : column.key === "marketplace_name" ? (
              <div className="payout-report-scope">
                <span>{payoutMarketplaceLabel(row)}</span>
                {history ? (
                  <Group gap="xs">
                    <TableDisclosure
                      expanded={history.expanded}
                      subject="versions"
                      context={label}
                      onToggle={history.onToggle}
                    />
                    <LoadingStatus state={history.updating ? "updating" : null} />
                  </Group>
                ) : null}
              </div>
            ) : (
              <TableCellValue column={column} row={row} companies={companies} />
            )}
          </Table.Td>
        );
      })}
    </Table.Tr>
  );
}
