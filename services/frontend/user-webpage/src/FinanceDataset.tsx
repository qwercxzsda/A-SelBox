import "./FinanceDataset.css";
import { Alert, Button, CloseButton, Group, Text, TextInput } from "@mantine/core";
import { type TableDatasetKey, DATASET_CONFIG } from "./api";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import { DATASET_PRESENTATION, displayColumns, getErrorMessage } from "./view-model";
import type { Identity } from "./auth-session";
import { FinancialTable } from "./FinancialTable";
import { UpdateStatus } from "./UpdateStatus";
import { PaginationBar } from "./PaginationBar";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";
import { FinanceColumnHeader } from "./FinanceColumnHeader";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";
import { AmountOrderingLimitError } from "./api/amount-ordering";
import { PayoutReports } from "./PayoutReports";
import { AppliedTableFilters } from "./AppliedTableFilters";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { filterOptions, transactionTypeValues } from "./filter-options";
import { transactionTypeSelectionLabels } from "./transaction-type-groups";
import { RowsSelect } from "./RowsSelect";

interface FinanceDatasetProps extends ViewStateProps<DatasetViewState> {
  identity: Identity;
  dataset: TableDatasetKey;
  onRetry: () => Promise<void>;
  reviewMode?: boolean;
}

export function FinanceDataset(props: FinanceDatasetProps) {
  return props.dataset === "payouts" ? (
    <PayoutReports {...props} />
  ) : (
    <StandardFinanceDataset {...props} />
  );
}

function StandardFinanceDataset({
  identity,
  dataset,
  onRetry,
  viewState,
  onViewStateChange,
}: FinanceDatasetProps) {
  const { table, query, totalCount, search, changeSearch, filters, changeFilters, companies } =
    useFinanceTable(identity, dataset, viewState, onViewStateChange);
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
      <WorkspaceIntro description={presentation.description} />
      {query.error ? (
        <Alert color={amountLimitExceeded ? "orange" : "red"} role="alert" mb="md">
          {getErrorMessage(query.error)}
          {amountLimitExceeded ? (
            <Button
              variant="subtle"
              onClick={() => {
                const defaultSort = DATASET_CONFIG[dataset].defaultSort;
                table.setSorting([{ id: defaultSort.column, desc: true }]);
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
          {DATASET_CONFIG[dataset].searchColumns.length > 0 ? (
            <TextInput
              className="search-field"
              label="Search"
              type="search"
              value={search}
              placeholder={presentation.searchPlaceholder}
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
          ) : null}
          <RowsSelect
            value={pageSize}
            onChange={(pageSize) => {
              table.setPagination({ pageIndex: 0, pageSize });
            }}
          />
        </Group>
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
      </Group>
      <AppliedTableFilters
        dataset={dataset}
        filters={filters}
        companies={companies}
        typeLabels={transactionTypeSelectionLabels(
          filterOptions(
            "component_type",
            transactionTypeValues(dataset, identity.account.access_role),
            filters.types,
          ),
          filters.types,
        )}
        onChange={changeFilters}
      />
      <FinancialTable
        dataset={dataset}
        table={table}
        isBusy={isBusy}
        status={
          query.countQuery.isError ? (
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
          )
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
              <>
                <Text c="dimmed" size="sm">
                  Adjust your search or filters, or reset them to see all records.
                </Text>
                <Button
                  mt="sm"
                  variant="light"
                  onClick={() => {
                    onViewStateChange({
                      ...viewState,
                      search: "",
                      filters: normalizeDatasetFilters(),
                      pagination: { ...viewState.pagination, pageIndex: 0 },
                      selectedRowId: null,
                    });
                  }}
                >
                  Reset search and filters
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </FinancialTable>
      <RowDetail
        accessToken={identity.session.access_token}
        isAdministrator={identity.account.access_role === "operator"}
        companies={companies}
        dataset={dataset}
        row={selectedRow}
        onClose={() => {
          table.resetRowSelection();
        }}
      />
    </>
  );
}
