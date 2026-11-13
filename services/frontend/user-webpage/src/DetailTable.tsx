import { Table } from "@mantine/core";
import { useResizeObserver } from "@mantine/hooks";
import type { ReactNode } from "react";
import type { CanonicalRow } from "./api";
import { humanizeCode } from "./categories";
import { TransactionTypeValue } from "./TransactionTypeValue";
import { formatAmount, formatExactDecimal } from "./decimal";
import type { DetailColumn } from "./detail-columns";
import { TableColumnLabel } from "./TableColumnLabel";
import { formatRecordDate } from "./date-display";
import { inspectableRowProps } from "./inspectable-row";
import "./DetailTable.css";

function cellContent(row: CanonicalRow, column: DetailColumn) {
  const value = row[column.key] ?? null;
  if (column.kind === "amount") return formatAmount(value);
  if (column.kind === "number") return formatExactDecimal(value);
  if (value === null) return column.empty ?? "—";
  if (column.kind === "date")
    return (
      <time dateTime={value} title={value}>
        {formatRecordDate(value)}
      </time>
    );
  if (column.kind === "source") return humanizeCode(value);
  if (column.kind === "type") return <TransactionTypeValue value={value} />;
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
  onSelectRow,
}: {
  label: string;
  columns: DetailColumn[];
  rows: CanonicalRow[];
  rowKey: (row: CanonicalRow) => string;
  minWidth?: number;
  className?: string;
  selectedRowKey?: string | null;
  renderCell?: (row: CanonicalRow, column: DetailColumn) => ReactNode;
  onSelectRow?: (row: CanonicalRow) => void;
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
        stickyHeaderOffset="var(--ui-drawer-content-header-height, var(--ui-drawer-header-height))"
        highlightOnHover={selectedRowKey !== undefined || onSelectRow !== undefined}
      >
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th
                key={column.key}
                scope="col"
                data-column={column.key}
                data-kind={column.kind}
              >
                <TableColumnLabel label={column.label} />
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey === key;
            return (
              <Table.Tr
                key={key}
                {...(onSelectRow
                  ? inspectableRowProps(selected, () => {
                      onSelectRow(row);
                    })
                  : {})}
                aria-selected={selectedRowKey === undefined ? undefined : selected}
              >
                {columns.map((column) => {
                  const content = renderCell?.(row, column);
                  return (
                    <Table.Td
                      key={column.key}
                      data-column={column.key}
                      data-kind={column.kind}
                      data-nowrap={column.nowrap}
                    >
                      {content === undefined ? cellContent(row, column) : content}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </div>
  );
}
