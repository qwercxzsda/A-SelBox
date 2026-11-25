import type { RefObject } from "react";
import { Table } from "@mantine/core";
import type { Company } from "./api";
import { ColumnMenu } from "./ColumnMenu";
import { EmptyState } from "./EmptyState";
import { ListRowName } from "./ListRowName";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { RecordTimestamp } from "./RecordTimestamp";
import { inspectableRowProps } from "./inspectable-row";
import type { CompanyListState, CompanySortColumn } from "./companies-view";

const SORT_LABELS: Record<CompanySortColumn, { ascending: string; descending: string }> = {
  name: { ascending: "A to Z", descending: "Z to A" },
  skus: { ascending: "Lowest first", descending: "Highest first" },
  created: { ascending: "Oldest first", descending: "Newest first" },
};

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
            ascendingLabel: SORT_LABELS[column].ascending,
            descendingLabel: SORT_LABELS[column].descending,
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
    orderedColumn("created", "Created (UTC)"),
  ];
  return (
    <RecordTable
      label="Companies"
      columns={columns}
      minWidth={480}
      emptyState={
        visible.length === 0 ? (
          <EmptyState
            title={hasSearch ? "No matching companies" : "No companies yet"}
            action={
              hasSearch
                ? {
                    label: "Reset search",
                    focusTarget: searchInput,
                    onClick: () => {
                      onChange({ search: "", pageIndex: 0 });
                    },
                  }
                : undefined
            }
          />
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
              <ListRowName>{company.name}</ListRowName>
            </Table.Td>
            <Table.Td className="numeric">
              <span aria-label={assignmentSummary}>{skus.length.toLocaleString("en-US")}</span>
            </Table.Td>
            <Table.Td>
              {company.created_at ? (
                <RecordTimestamp value={company.created_at} />
              ) : (
                <span className="muted-value">—</span>
              )}
            </Table.Td>
          </Table.Tr>
        );
      })}
    </RecordTable>
  );
}
