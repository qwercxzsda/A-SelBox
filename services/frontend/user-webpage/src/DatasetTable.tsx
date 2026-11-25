import type { RefObject } from "react";
import type { TableDatasetKey } from "./api";
import type { Identity } from "./auth-session";
import { AppliedTableFilters } from "./AppliedTableFilters";
import { DatasetCountStatus } from "./DatasetCountStatus";
import { EmptyState } from "./EmptyState";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { FinancialTable } from "./FinancialTable";
import { filterOptions, transactionTypeValues } from "./filter-options";
import { transactionTypeSelectionLabels } from "./transaction-type-groups";
import type { useFinanceTable } from "./use-finance-table";
import { useBrowserOnline } from "./use-browser-online";
import { displayColumns } from "./table-columns";
import { DATASET_PRESENTATION } from "./view-model";

/** One server-paginated list: applied chips, column menus, rows and the empty state. */
export function DatasetTable({
  identity,
  dataset,
  list,
  searchInput,
  onCountRetry,
}: {
  identity: Identity;
  dataset: TableDatasetKey;
  list: ReturnType<typeof useFinanceTable>;
  searchInput: RefObject<HTMLInputElement | null>;
  onCountRetry: () => void;
}) {
  const online = useBrowserOnline();
  const { table, query, totalCount, filters, changeFilters, companies, hasRefinements } = list;
  const role = identity.account.access_role;
  const columns = displayColumns(dataset, role === "administrator");
  const sort = table.state.sorting[0];
  const { pageIndex } = table.state.pagination;
  return (
    <FinancialTable
      dataset={dataset}
      table={table}
      isBusy={query.isFetching}
      isPlaceholderData={query.isPlaceholderData}
      appliedFilters={
        <AppliedTableFilters
          focusTarget={searchInput}
          dataset={dataset}
          filters={filters}
          companies={companies}
          typeLabels={transactionTypeSelectionLabels(
            filterOptions("component_type", transactionTypeValues(dataset, role), filters.types),
            filters.types,
          )}
          onChange={changeFilters}
        />
      }
      status={
        <DatasetCountStatus
          isError={query.countQuery.isError}
          isFetching={false}
          onRetry={onCountRetry}
        />
      }
      renderColumnHeader={(columnId) => {
        const column = columns.find((definition) => definition.key === columnId);
        return column ? (
          <FinanceColumnHeader
            column={column}
            dataset={dataset}
            identity={identity}
            filters={filters}
            onFiltersChange={changeFilters}
            sort={{ column: sort.id, direction: sort.desc ? "desc" : "asc" }}
            totalCount={query.totalCount}
            onSortChange={({ column: id, direction }) => {
              table.setSorting([{ id, desc: direction === "desc" }]);
            }}
          />
        ) : null;
      }}
    >
      {query.isPending && !online ? (
        <div className="loading-state" role="status">
          Waiting for a connection to load rows…
        </div>
      ) : null}
      {!query.isPending && !query.isError && table.getRowModel().rows.length === 0 ? (
        <EmptyState
          title={
            pageIndex > 0 && totalCount === null
              ? "No rows on this page"
              : hasRefinements
                ? DATASET_PRESENTATION[dataset].noMatchMessage
                : DATASET_PRESENTATION[dataset].emptyMessage
          }
          action={
            hasRefinements
              ? {
                  label: "Reset search and filters",
                  focusTarget: searchInput,
                  onClick: list.resetSearchAndFilters,
                }
              : undefined
          }
        />
      ) : null}
    </FinancialTable>
  );
}
