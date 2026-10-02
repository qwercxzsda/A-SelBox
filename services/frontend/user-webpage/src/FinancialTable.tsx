import "./FinancialTable.css";
import { useId, useRef, type ReactNode } from "react";
import { Group, Paper, Table, Text } from "@mantine/core";
import type { TableDatasetKey } from "./api";
import type { useFinanceTable } from "./use-finance-table";
import { TableScrollControls } from "./TableScrollControls";
import { inspectableRowProps } from "./inspectable-row";

/** Presentation and keyboard selection for the server-paginated table. */
export function FinancialTable({
  dataset,
  table,
  isBusy,
  renderColumnHeader,
  status,
  children,
}: {
  dataset: TableDatasetKey;
  table: ReturnType<typeof useFinanceTable>["table"];
  isBusy: boolean;
  renderColumnHeader: (columnId: string) => ReactNode;
  status: ReactNode;
  children: ReactNode;
}) {
  const scrollTarget = useRef<HTMLDivElement>(null);
  const scrollId = useId();
  return (
    <>
      <Group gap="xs" justify="space-between" mb="xs" mih={22}>
        <Text size="xs" c="dimmed">
          Column headings offer filters and ordering. Select a row or press Enter for details.
        </Text>
        <Group gap="xs">
          <TableScrollControls target={scrollTarget} targetId={scrollId} />
          {status}
        </Group>
      </Group>
      <Paper withBorder className="table-card" data-dataset={dataset} aria-busy={isBusy}>
        <div
          id={scrollId}
          ref={scrollTarget}
          className="table-horizontal-scroll"
          role="region"
          aria-label="Financial table"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
          tabIndex={0}
        >
          <Table
            highlightOnHover
            aria-label="Financial records"
            miw={Math.max(900, table.getAllLeafColumns().length * 120)}
          >
            <Table.Thead>
              {table.getHeaderGroups().map((group) => (
                <Table.Tr key={group.id}>
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <Table.Th
                        key={header.id}
                        data-column={header.column.id}
                        className={
                          header.column.columnDef.meta?.align === "right" ? "numeric" : undefined
                        }
                        scope="col"
                        aria-sort={
                          header.column.getCanSort()
                            ? sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                      >
                        {renderColumnHeader(header.column.id) ?? (
                          <table.FlexRender header={header} />
                        )}
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Thead>
            <Table.Tbody>
              {table.getRowModel().rows.map((row) => (
                <Table.Tr
                  key={row.id}
                  {...inspectableRowProps(row.getIsSelected(), () => {
                    row.toggleSelected(true);
                  })}
                >
                  {row.getAllCells().map((cell) => (
                    <Table.Td
                      key={cell.id}
                      data-column={cell.column.id}
                      className={
                        cell.column.columnDef.meta?.align === "right" ? "numeric" : undefined
                      }
                    >
                      <table.FlexRender cell={cell} />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {children}
        </div>
      </Paper>
    </>
  );
}
