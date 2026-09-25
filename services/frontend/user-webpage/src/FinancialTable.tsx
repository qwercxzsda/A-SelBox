import "./FinancialTable.css";
import type { ReactNode } from "react";
import { Paper, Table } from "@mantine/core";
import type { useFinanceTable } from "./use-finance-table";

/** Presentation and keyboard selection for the server-paginated table. */
export function FinancialTable({
  table,
  isBusy,
  renderColumnHeader,
  children,
}: {
  table: ReturnType<typeof useFinanceTable>["table"];
  isBusy: boolean;
  renderColumnHeader: (columnId: string) => ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper withBorder className="table-card" aria-busy={isBusy}>
      <div
        className="table-horizontal-scroll"
        role="region"
        aria-label="Financial table"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll wide tables horizontally.
        tabIndex={0}
      >
        <Table
          highlightOnHover
          fz="sm"
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
                tabIndex={0}
                aria-selected={row.getIsSelected()}
                aria-haspopup="dialog"
                className={row.getIsSelected() ? "inspectable-row selected" : "inspectable-row"}
                onClick={(event) => {
                  if (window.getSelection()?.type === "Range") return;
                  event.currentTarget.focus();
                  row.toggleSelected(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    row.toggleSelected(true);
                  }
                }}
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
  );
}
