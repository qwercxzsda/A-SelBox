import type { ReactNode } from "react";
import { Table } from "@mantine/core";
import "./AlertTable.css";

/** Structured items inside an alert, one aligned row each, instead of one sentence per item. */
export function AlertTable<Row>({
  label,
  columns,
  rows,
  rowKey,
}: {
  label: string;
  columns: readonly { key: string; label: string; value: (row: Row) => ReactNode }[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}) {
  return (
    <div className="alert-table-frame">
      <Table className="alert-table" aria-label={label}>
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th key={column.key} scope="col">
                {column.label}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={rowKey(row)}>
              {columns.map((column) => (
                <Table.Td key={column.key}>{column.value(row)}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
