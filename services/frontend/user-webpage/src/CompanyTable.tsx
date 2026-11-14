import type { RefObject } from "react";
import { Button, Table, Text } from "@mantine/core";
import type { Company } from "./api";
import { ColumnMenu } from "./ColumnMenu";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { inspectableRowProps } from "./inspectable-row";
import type { CompanyListState, CompanySortColumn } from "./companies-view";

export function CompanyTable({
  visible,
  assignments,
  state,
  onChange,
  searchInput,
}: {
  visible: readonly Company[];
  assignments: Map<string, string[]>;
  state: CompanyListState;
  onChange: (patch: Partial<CompanyListState>) => void;
  searchInput: RefObject<HTMLInputElement | null>;
}) {
  const hasSearch = state.search.trim().length > 0;
  function orderedColumn(column: CompanySortColumn, label: string): RecordColumn {
    const direction = state.sortColumn === column ? state.sortDirection : false;
    return {
      key: column,
      label,
      ariaSort: direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none",
      header: (
        <ColumnMenu
          label={label}
          sort={{
            direction,
            onChange: (sortDirection) => {
              onChange({ sortColumn: column, sortDirection, pageIndex: 0 });
            },
            ascendingLabel: column === "name" ? "A to Z" : "Lowest first",
            descendingLabel: column === "name" ? "Z to A" : "Highest first",
          }}
        />
      ),
    };
  }
  const columns: RecordColumn[] = [
    orderedColumn("name", "Company"),
    {
      ...orderedColumn("skus", "Assigned SKUs"),
      align: "right",
      width: 160,
    },
  ];
  return (
    <RecordTable
      label="Companies"
      columns={columns}
      minWidth={320}
      emptyState={
        visible.length === 0 ? (
          <>
            <Text c="dimmed">
              {hasSearch
                ? "No companies match this search."
                : "No companies yet. Add your first company to get started."}
            </Text>
            {hasSearch ? (
              <Button
                variant="subtle"
                onClick={(event) => {
                  if (event.detail === 0) searchInput.current?.focus();
                  onChange({ search: "", pageIndex: 0 });
                }}
              >
                Clear search
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {visible.map((company) => {
        const skus = assignments.get(company.id) ?? [];
        const assignmentSummary = `${skus.length.toLocaleString("en-US")} assigned ${skus.length === 1 ? "SKU" : "SKUs"}`;
        return (
          <Table.Tr
            key={company.id}
            {...inspectableRowProps(state.selected === company.id, () => {
              onChange({ selected: company.id });
            })}
          >
            <Table.Td>
              <Text size="var(--ui-font-data)" fw={500} className="company-list-name">
                {company.name}
              </Text>
            </Table.Td>
            <Table.Td className="numeric">
              <span aria-label={assignmentSummary}>{skus.length.toLocaleString("en-US")}</span>
            </Table.Td>
          </Table.Tr>
        );
      })}
    </RecordTable>
  );
}
