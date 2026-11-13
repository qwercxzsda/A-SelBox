import type { RefObject } from "react";
import { Button, Table, Text } from "@mantine/core";
import type { Company } from "./api";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { inspectableRowProps } from "./inspectable-row";
import type { CompanyListState, CompanySortColumn } from "./companies-view";
import { AppliedFilterChips } from "./AppliedFilterChips";

export function CompanyTable({
  companies,
  visible,
  assignments,
  state,
  onChange,
  searchInput,
}: {
  companies: readonly Company[];
  visible: readonly Company[];
  assignments: Map<string, string[]>;
  state: CompanyListState;
  onChange: (patch: Partial<CompanyListState>) => void;
  searchInput: RefObject<HTMLInputElement | null>;
}) {
  const query = state.search.trim();
  function ordering(column: CompanySortColumn): ColumnMenuSort {
    return {
      direction: state.sortColumn === column ? state.sortDirection : false,
      onChange: (sortDirection) => {
        onChange({ sortColumn: column, sortDirection, pageIndex: 0 });
      },
      ascendingLabel: column === "name" ? "A to Z" : "Lowest first",
      descendingLabel: column === "name" ? "Z to A" : "Highest first",
    };
  }
  const companyNames = new Map(companies.map(({ id, name }) => [id, name]));
  const columns: RecordColumn[] = [
    {
      key: "name",
      label: "Company",
      ariaSort:
        state.sortColumn === "name"
          ? state.sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none",
      header: (
        <ColumnMenu
          label="Company"
          sort={ordering("name")}
          filter={{
            kind: "selection",
            value: state.companyIds,
            options: [...new Set([...companyNames.keys(), ...state.companyIds])]
              .map((value) => ({ value, label: companyNames.get(value) ?? value }))
              .sort((left, right) => left.label.localeCompare(right.label)),
            onChange: (companyIds) => {
              onChange({ companyIds, pageIndex: 0 });
            },
          }}
        />
      ),
    },
    {
      key: "skus",
      label: "Assigned SKUs",
      align: "right",
      width: 160,
      ariaSort:
        state.sortColumn === "skus"
          ? state.sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none",
      header: <ColumnMenu label="Assigned SKUs" sort={ordering("skus")} />,
    },
  ];
  return (
    <>
      <AppliedFilterChips
        label="Applied company filters"
        chips={state.companyIds.map((id) => ({
          key: id,
          label: `Company: ${companyNames.get(id) ?? id}`,
          clear: { companyIds: state.companyIds.filter((value) => value !== id), pageIndex: 0 },
        }))}
        onChange={onChange}
        focusTarget={searchInput}
      />
      <RecordTable
        label="Companies"
        columns={columns}
        minWidth={320}
        emptyState={
          visible.length === 0 ? (
            <>
              <Text c="dimmed">
                {query || state.companyIds.length
                  ? "No companies match these filters."
                  : "No companies yet. Add your first company to get started."}
              </Text>
              {query || state.companyIds.length ? (
                <Button
                  variant="subtle"
                  onClick={(event) => {
                    if (event.detail === 0) searchInput.current?.focus();
                    onChange({ search: "", companyIds: [], pageIndex: 0 });
                  }}
                >
                  {state.companyIds.length ? "Clear filters" : "Clear search"}
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
    </>
  );
}
