import type { ReactNode } from "react";
import { Table, Stack } from "@mantine/core";
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
  minWidth = 700,
  grouped = false,
  className,
}: {
  label: string;
  columns: readonly RecordColumn[];
  children: ReactNode;
  emptyState?: ReactNode;
  minWidth?: number;
  grouped?: boolean;
  className?: string;
}) {
  return (
    <TableFrame label={`${label} table`}>
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
      {emptyState ? (
        <Stack align="center" gap="sm" p="xl" ta="center">
          {emptyState}
        </Stack>
      ) : null}
    </TableFrame>
  );
}
