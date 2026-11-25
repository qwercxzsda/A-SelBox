import type { ReactNode } from "react";
import { Table } from "@mantine/core";
import { TableFrame } from "./TableFrame";

export interface RecordColumn {
  key: string;
  label: string;
  align?: "right";
  width?: number | string;
  header?: ReactNode;
  ariaSort?: "ascending" | "descending" | "none";
}

export function RecordTable({
  label,
  columns,
  children,
  emptyState,
  appliedFilters,
  isPlaceholderData,
  minWidth = 700,
  grouped = false,
  className,
}: {
  label: string;
  columns: readonly RecordColumn[];
  children: ReactNode;
  /** An `EmptyState`, shown inside the frame below the column headings. */
  emptyState?: ReactNode;
  /** Applied-filter chips for the frame's status row. */
  appliedFilters?: ReactNode;
  isPlaceholderData?: boolean;
  minWidth?: number;
  grouped?: boolean;
  className?: string;
}) {
  return (
    <TableFrame
      label={`${label} table`}
      appliedFilters={appliedFilters}
      isPlaceholderData={isPlaceholderData}
    >
      <Table className={className} highlightOnHover aria-label={label} miw={minWidth}>
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th
                key={column.key}
                scope="col"
                className={column.align === "right" ? "numeric" : undefined}
                style={{ width: column.width }}
                aria-sort={column.ariaSort}
              >
                {column.header ?? column.label}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        {grouped ? children : <Table.Tbody>{children}</Table.Tbody>}
      </Table>
      {emptyState}
    </TableFrame>
  );
}
