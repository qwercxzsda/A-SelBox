import "./FinanceDataset.css";
import { Alert, Button, CloseButton, Group, NativeSelect, Text, TextInput } from "@mantine/core";
import { type DatasetKey, DATASET_CONFIG } from "./api";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import { DATASET_PRESENTATION, PAGE_SIZES, displayColumns, getErrorMessage } from "./view-model";
import type { Identity } from "./auth-session";
import { FinancialTable } from "./FinancialTable";
import { UpdateStatus } from "./UpdateStatus";
import { PaginationBar } from "./PaginationBar";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";
import { AmountOrderingLimitError } from "./api/amount-ordering";

export function FinanceDataset({
  identity,
  dataset,
  onRetry,
  viewState,
  onViewStateChange,
}: {
  identity: Identity;
  dataset: DatasetKey;
  onRetry: () => Promise<void>;
} & ViewStateProps<DatasetViewState>) {
  const {
    table,
    query,
    totalCount,
    search,
    changeSearch,
    filters,
    changeFilters,
    companies,
    skuNames,
  } = useFinanceTable(identity, dataset, viewState, onViewStateChange);
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows;
  const presentation = DATASET_PRESENTATION[dataset];
  const pageCount = totalCount === null ? null : table.getPageCount();
  const isBusy = query.isFetching;
  const selectedRow = table.getSelectedRowModel().rows[0]?.original ?? null;
  const filterCount = activeFilterCount(filters);
  const hasFilters = filterCount > 0;
  const hasRefinements = hasFilters || search.trim().length > 0;
  const columns = displayColumns(dataset, identity.account.access_role === "operator");
  const sort = viewState.sorting[0];
  const amountLimitExceeded = query.error instanceof AmountOrderingLimitError;
  return (
    <>
      <Text mb="md" role="note" c="dimmed" size="sm">
        {presentation.description}
      </Text>
      {query.error ? (
        <Alert color={amountLimitExceeded ? "orange" : "red"} role="alert" mb="md">
          {getErrorMessage(query.error)}
          {amountLimitExceeded ? (
            <Button
              variant="subtle"
              onClick={() => {
                const defaultSort = DATASET_CONFIG[dataset].defaultSort;
                table.setSorting([
                  { id: defaultSort.column, desc: defaultSort.direction === "desc" },
                ]);
              }}
            >
              Order by date
            </Button>
          ) : (
            <Button variant="subtle" disabled={isBusy} onClick={() => void onRetry()}>
              Retry
            </Button>
          )}
        </Alert>
      ) : null}
      <Group className="table-toolbar" justify="space-between" align="end">
        <Group align="end" className="table-toolbar-fields">
          <TextInput
            className="search-field"
            label="Search"
            type="search"
            value={search}
            placeholder={presentation.searchPlaceholder}
            disabled={DATASET_CONFIG[dataset].searchColumns.length === 0}
            rightSectionPointerEvents="auto"
            rightSection={
              search ? (
                <CloseButton
                  aria-label="Clear search"
                  onClick={() => {
                    changeSearch("");
                  }}
                />
              ) : undefined
            }
            onChange={(event) => {
              changeSearch(event.currentTarget.value);
            }}
          />
          <NativeSelect
            label="Rows"
            value={pageSize}
            data={PAGE_SIZES.map(String)}
            onChange={(event) => {
              table.setPagination({ pageIndex: 0, pageSize: Number(event.currentTarget.value) });
            }}
          />
        </Group>
      </Group>
      {hasFilters ? (
        <Group gap="xs" mb="xs">
          <Text size="sm" c="dimmed">
            {filterCount} {filterCount === 1 ? "filter" : "filters"} applied
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              changeFilters(normalizeDatasetFilters());
            }}
          >
            Clear filters
          </Button>
        </Group>
      ) : null}
      <PaginationBar
        pageIndex={pageIndex}
        pageCount={pageCount}
        canPrevious={table.getCanPreviousPage()}
        canNext={totalCount === null ? rows.length === pageSize : table.getCanNextPage()}
        isBusy={isBusy}
        onPrevious={() => {
          table.previousPage();
        }}
        onNext={() => {
          table.nextPage();
        }}
        onPageChange={(index) => {
          table.setPageIndex(index);
        }}
        summary={
          amountLimitExceeded
            ? "Narrow your filters or order by date to load rows."
            : query.isPending
              ? `Loading page ${String(pageIndex + 1)}…`
              : `${String(rows.length === 0 ? 0 : pageIndex * pageSize + 1)}–${String(rows.length === 0 ? 0 : pageIndex * pageSize + rows.length)} of ${totalCount?.toLocaleString("en-US") ?? "—"} rows`
        }
      />
      <Group gap="xs" mb="xs" mih={24}>
        {query.countQuery.isError ? (
          <>
            <Text size="xs" c="red" role="status">
              Row count unavailable.
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => void query.countQuery.refetch()}
            >
              Retry count
            </Button>
          </>
        ) : (
          <UpdateStatus active={query.countQuery.isFetching}>Counting rows…</UpdateStatus>
        )}
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        Select a row or press Enter to view its details.
      </Text>
      <FinancialTable
        table={table}
        isBusy={isBusy}
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
        {query.isPending ? (
          <div className="loading-state" role="status">
            Loading rows…
          </div>
        ) : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <div className="empty-state">
            <Text fw={600}>
              {pageIndex > 0 && totalCount === null
                ? "No rows on this page"
                : hasRefinements
                  ? "No matching records"
                  : presentation.emptyMessage}
            </Text>
            {hasRefinements ? (
              <Text c="dimmed" size="sm">
                {hasFilters
                  ? "Adjust your selections or use Clear filters to see more records."
                  : "Try a different search or use Clear search to see all records."}
              </Text>
            ) : null}
          </div>
        ) : null}
      </FinancialTable>
      <RowDetail
        isAdministrator={identity.account.access_role === "operator"}
        companies={companies}
        dataset={dataset}
        row={selectedRow}
        skuNames={skuNames}
        onClose={() => {
          table.resetRowSelection();
        }}
      />
    </>
  );
}
