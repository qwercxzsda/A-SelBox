import { Table } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import type { ReactNode } from "react";
import type { CanonicalRow } from "./api";
import { humanizeCode, transactionTypeLabel } from "./categories";
import { formatExactDecimal } from "./decimal";
import type { DetailColumn } from "./detail-columns";
import { TableColumnLabel } from "./TableColumnLabel";
import "./DetailTable.css";

function cellText(row: CanonicalRow, column: DetailColumn) {
  const value = row[column.key];
  if (column.kind === "number") return formatExactDecimal(value);
  if (value === null) return column.empty ?? "—";
  if (column.kind === "source") return humanizeCode(value);
  if (column.kind === "type") return transactionTypeLabel(value);
  return value;
}

/** Every financial detail table shares typography, alignment, and keyboard scrolling. */
export function DetailTable({
  label,
  columns,
  rows,
  rowKey,
  minWidth = 960,
  className,
  selectedRowKey,
  renderCell,
}: {
  label: string;
  columns: DetailColumn[];
  rows: CanonicalRow[];
  rowKey: (row: CanonicalRow) => string;
  minWidth?: number;
  className?: string;
  selectedRowKey?: string | null;
  renderCell?: (row: CanonicalRow, column: DetailColumn) => ReactNode;
}) {
  const [containerRef, container] = useResizeObserver<HTMLDivElement>();
  const [tableRef, table] = useResizeObserver<HTMLTableElement>();
  const fits = container.width > 0 && table.width <= container.width + 1;
  return (
    <div
      ref={containerRef}
      className="detail-table-scroll"
      data-fitting={fits}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
      tabIndex={0}
      role="region"
      aria-label={`${label} table`}
    >
      <Table
        ref={tableRef}
        aria-label={label}
        className={["detail-table", className].filter(Boolean).join(" ")}
        style={{ minWidth }}
        stickyHeader={fits}
        stickyHeaderOffset="var(--ui-drawer-header-height)"
        highlightOnHover={selectedRowKey !== undefined}
      >
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th key={column.key} data-kind={column.kind}>
                <TableColumnLabel label={column.label} />
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr
              key={rowKey(row)}
              aria-selected={
                selectedRowKey === undefined ? undefined : selectedRowKey === rowKey(row)
              }
            >
              {columns.map((column) => {
                const content = renderCell?.(row, column);
                return (
                  <Table.Td key={column.key} data-kind={column.kind} data-nowrap={column.nowrap}>
                    {content === undefined ? cellText(row, column) : content}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
