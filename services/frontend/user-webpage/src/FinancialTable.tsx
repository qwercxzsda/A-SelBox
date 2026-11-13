import type { ReactNode } from "react";
import { Table } from "@mantine/core";
import type { TableDatasetKey } from "./api";
import type { useFinanceTable } from "./use-finance-table";
import { inspectableRowProps } from "./inspectable-row";
import { TableFrame } from "./TableFrame";

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
  return (
    <TableFrame
      label={dataset === "accounts" ? "Account table" : "Financial table"}
      dataset={dataset}
      isBusy={isBusy}
      status={status}
    >
      <Table
        highlightOnHover
        aria-label={dataset === "accounts" ? "User accounts" : "Financial records"}
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
                    {renderColumnHeader(header.column.id) ?? <table.FlexRender header={header} />}
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
                  className={cell.column.columnDef.meta?.align === "right" ? "numeric" : undefined}
                >
                  <table.FlexRender cell={cell} />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {children}
    </TableFrame>
  );
}
