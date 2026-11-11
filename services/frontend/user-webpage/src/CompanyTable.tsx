import type { RefObject } from "react";
import { Button, Group, Table, Text } from "@mantine/core";
import type { Company } from "./api";
import { ColumnMenu, type ColumnMenuSort } from "./ColumnMenu";
import { CompanyDetails } from "./CompanyDetails";
import { ExpandableTable, ExpandableTableRow, type ExpandableColumn } from "./ExpandableTable";
import type { CompanyListState, CompanySortColumn } from "./companies-view";

export function CompanyTable({
  companies,
  visible,
  assignments,
  state,
  onChange,
  searchInput,
  onShowMembers,
  onShowTransactions,
  onDeleted,
}: {
  companies: readonly Company[];
  visible: readonly Company[];
  assignments: Map<string, string[]>;
  state: CompanyListState;
  onChange: (patch: Partial<CompanyListState>) => void;
  searchInput: RefObject<HTMLInputElement | null>;
  onShowMembers: (companyId: string) => void;
  onShowTransactions: (sku: string) => void;
  onDeleted: (company: Company, deleted: boolean) => void;
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
  const columns: ExpandableColumn[] = [
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
      {state.companyIds.length ? (
        <Group gap="xs" mb="sm" role="group" aria-label="Applied company filters">
          <Text size="xs" c="dimmed">
            Applied filters
          </Text>
          {state.companyIds.map((id) => {
            const label = `Company: ${companyNames.get(id) ?? id}`;
            return (
              <Button
                key={id}
                className="company-filter-chip"
                variant="light"
                size="compact-xs"
                aria-label={`Remove ${label}`}
                rightSection={<span aria-hidden="true">×</span>}
                onClick={(event) => {
                  if (event.detail === 0) searchInput.current?.focus();
                  onChange({
                    companyIds: state.companyIds.filter((value) => value !== id),
                    pageIndex: 0,
                  });
                }}
              >
                {label}
              </Button>
            );
          })}
        </Group>
      ) : null}
      <ExpandableTable
        label="Companies"
        columns={columns}
        minWidth={640}
        actionsWidth={140}
        onCollapseAll={
          state.expanded.length
            ? () => {
                onChange({ expanded: [] });
              }
            : undefined
        }
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
          const expanded = state.expanded.includes(company.id);
          const assignmentSummary = `${skus.length.toLocaleString("en-US")} assigned ${skus.length === 1 ? "SKU" : "SKUs"}`;
          return (
            <ExpandableTableRow
              key={company.id}
              expanded={expanded}
              onToggle={() => {
                onChange({
                  expanded: expanded
                    ? state.expanded.filter((id) => id !== company.id)
                    : [...state.expanded, company.id],
                });
              }}
              toggleLabel={`details for ${company.name}: ${assignmentSummary}`}
              detailsLabel={`Company details for ${company.name}`}
              columnCount={columns.length + 2}
              actions={
                <Button
                  variant="subtle"
                  size="compact-xs"
                  onClick={() => {
                    onShowMembers(company.id);
                  }}
                >
                  View members
                </Button>
              }
              details={
                <CompanyDetails
                  company={company}
                  skus={skus}
                  onShowTransactions={onShowTransactions}
                  onDeleted={onDeleted}
                />
              }
            >
              <Table.Td>
                <Text size="sm" fw={500} className="company-list-name">
                  {company.name}
                </Text>
              </Table.Td>
              <Table.Td className="numeric">
                <span aria-label={assignmentSummary}>{skus.length.toLocaleString("en-US")}</span>
              </Table.Td>
            </ExpandableTableRow>
          );
        })}
      </ExpandableTable>
    </>
  );
}
