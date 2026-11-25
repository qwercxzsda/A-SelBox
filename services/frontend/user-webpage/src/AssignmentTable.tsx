import type { ReactNode } from "react";
import { Table } from "@mantine/core";
import { ASSIGNMENT_KINDS, assignmentKey, type Assignment } from "./api/assignment-types";
import {
  ASSIGNMENT_KIND_LABELS,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONES,
  assignmentStatus,
  marketplaceSummary,
  type AssignmentFilters,
  type AssignmentListState,
} from "./assignments-view";
import { ColumnMenu } from "./ColumnMenu";
import { inspectableRowProps } from "./inspectable-row";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { codeMenu, companyMenu, marketplaceMenu, type SelectionMenu } from "./selection-filters";
import { MutedValue } from "./StackedValue";
import { StatusBadge } from "./StatusBadge";
import { companyLabel } from "./view-model";
import "./GroupedTable.css";

function MenuHeader({ label, menu }: { label: string; menu: SelectionMenu }) {
  return <ColumnMenu label={label} filter={{ kind: "selection", ...menu }} />;
}

function AssignmentRow({
  row,
  administrator,
  companies,
  selected,
  onSelect,
}: {
  row: Assignment;
  administrator: boolean;
  companies: Map<string, string>;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const key = assignmentKey(row);
  const status = assignmentStatus(row);
  const marketplaces = row.marketplaceNames;
  return (
    <Table.Tr
      data-assignment-key={key}
      {...inspectableRowProps(selected, () => {
        onSelect(key);
      })}
    >
      <Table.Th scope="row" className="group-header-cell assignment-reference">
        {row.nativeKey}
      </Table.Th>
      <Table.Td>{ASSIGNMENT_KIND_LABELS[row.kind]}</Table.Td>
      {administrator ? <Table.Td>{companyLabel(row.companyId, companies)}</Table.Td> : null}
      <Table.Td title={marketplaces.length > 1 ? marketplaces.join(", ") : undefined}>
        {marketplaceSummary(marketplaces) ?? <MutedValue />}
      </Table.Td>
      {administrator ? (
        <Table.Td>
          <StatusBadge tone={ASSIGNMENT_STATUS_TONES[status]}>
            {ASSIGNMENT_STATUS_LABELS[status]}
          </StatusBadge>
        </Table.Td>
      ) : null}
    </Table.Tr>
  );
}

/** Members see their own company's IDs, so Company and Status are administrator columns. */
export function AssignmentTable({
  rows,
  state,
  administrator,
  companies,
  appliedFilters,
  emptyState,
  onFiltersChange,
  onSelect,
}: {
  rows: readonly Assignment[];
  state: AssignmentListState;
  administrator: boolean;
  companies: Map<string, string>;
  appliedFilters: ReactNode;
  emptyState: ReactNode;
  onFiltersChange: (patch: Partial<AssignmentFilters>) => void;
  onSelect: (key: string) => void;
}) {
  const columns: RecordColumn[] = [
    { key: "native_key", label: "Reference ID", width: 220 },
    {
      key: "kind",
      label: "Source",
      width: 140,
      header: (
        <MenuHeader
          label="Source"
          menu={codeMenu(ASSIGNMENT_KINDS, ASSIGNMENT_KIND_LABELS, state.kinds, (kinds) => {
            onFiltersChange({ kinds });
          })}
        />
      ),
    },
    ...(administrator
      ? [
          {
            key: "company",
            label: "Company",
            width: 180,
            header: (
              <MenuHeader
                label="Company"
                menu={companyMenu(state.companyIds, companies, (companyIds) => {
                  onFiltersChange({ companyIds });
                })}
              />
            ),
          },
        ]
      : []),
    {
      key: "marketplace",
      label: "Marketplace",
      width: 165,
      header: (
        <MenuHeader
          label="Marketplace"
          menu={marketplaceMenu(state.marketplaces, (marketplaces) => {
            onFiltersChange({ marketplaces });
          })}
        />
      ),
    },
    ...(administrator
      ? [
          {
            key: "status",
            label: "Status",
            width: 145,
            header: (
              <MenuHeader
                label="Status"
                menu={codeMenu(
                  ASSIGNMENT_STATUSES,
                  ASSIGNMENT_STATUS_LABELS,
                  state.statuses,
                  (statuses) => {
                    onFiltersChange({ statuses });
                  },
                )}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <RecordTable
      label="Assignments"
      columns={columns}
      className="assignment-table grouped-table"
      minWidth={administrator ? 850 : 525}
      appliedFilters={appliedFilters}
      emptyState={emptyState}
    >
      {rows.map((row) => (
        <AssignmentRow
          key={assignmentKey(row)}
          row={row}
          administrator={administrator}
          companies={companies}
          selected={state.selected === assignmentKey(row)}
          onSelect={onSelect}
        />
      ))}
    </RecordTable>
  );
}
