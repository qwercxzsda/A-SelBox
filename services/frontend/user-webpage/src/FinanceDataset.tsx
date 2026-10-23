import "./FinanceDataset.css";
import { Alert, Button, Group, Text } from "@mantine/core";
import { type TableDatasetKey, DATASET_CONFIG } from "./api";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import { DATASET_PRESENTATION, displayColumns, getErrorMessage } from "./view-model";
import type { Identity } from "./auth-session";
import { FinancialTable } from "./FinancialTable";
import { DatasetCountStatus } from "./DatasetCountStatus";
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
import { CompanyMembership } from "./CompanyMembership";
import { useBrowserOnline } from "./use-browser-online";
import { useRef } from "react";
import { FinancialSourceLookup } from "./FinancialSourceLookup";
import { ActivityEligibilityHelp } from "./ActivityEligibilityHelp";
import { SearchInput } from "./SearchInput";
import { ListPageNavigation } from "./ListPageNavigation";
import { pageRangeSummary } from "./pagination";

interface FinanceDatasetProps extends ViewStateProps<DatasetViewState> {
  identity: Identity;
  dataset: TableDatasetKey;
  onRetry: () => Promise<void>;
  onAddCompany?: () => void;
  onConfigureSku?: (sku: string) => void;
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
  onAddCompany,
}: FinanceDatasetProps) {
  const online = useBrowserOnline();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const { table, query, totalCount, search, changeSearch, filters, changeFilters, companies } =
    useFinanceTable(identity, dataset, viewState, onViewStateChange);
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows;
  const presentation = DATASET_PRESENTATION[dataset];
  const pageCount = totalCount === null ? null : table.getPageCount();
  const canPrevious = table.getCanPreviousPage();
  const canNext = totalCount === null ? rows.length === pageSize : table.getCanNextPage();
  const isBusy = query.isFetching;
  const selectedRow = table.getSelectedRowModel().rows[0]?.original ?? null;
  const hasRefinements = activeFilterCount(filters) > 0 || search.trim().length > 0;
  const columns = displayColumns(dataset, identity.account.access_role === "administrator");
  const sort = viewState.sorting[0];
  const amountLimitExceeded = query.error instanceof AmountOrderingLimitError;
  function showControls() {
    toolbarRef.current?.scrollIntoView({ block: "start" });
  }
  return (
    <>
      <WorkspaceIntro
        description={presentation.description}
        actions={
          dataset === "accounts" && onAddCompany ? (
            <Button variant="light" onClick={onAddCompany}>
              Add company
            </Button>
          ) : undefined
        }
      />
      {dataset === "finances" ? (
        <>
          <ActivityEligibilityHelp />
          <FinancialSourceLookup identity={identity} />
        </>
      ) : null}
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
      <Group ref={toolbarRef} className="table-toolbar" justify="space-between" align="end">
        <Group align="end" className="table-toolbar-fields">
          {DATASET_CONFIG[dataset].searchColumns.length > 0 ? (
            <SearchInput
              inputRef={searchInput}
              className="search-field"
              label="Search"
              description={dataset === "live" ? "Search records only" : undefined}
              type="search"
              value={search}
              placeholder={presentation.searchPlaceholder}
              onChange={changeSearch}
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
          canPrevious={canPrevious}
          canNext={canNext}
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
                : pageRangeSummary(pageIndex, pageSize, rows.length, totalCount, "rows")
          }
        />
      </Group>
      <AppliedTableFilters
        focusTarget={searchInput}
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
          <DatasetCountStatus
            isError={query.countQuery.isError}
            isFetching={query.countQuery.isFetching}
            items="rows"
            onRetry={() => void query.countQuery.refetch()}
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
        {query.isPending ? (
          <div className="loading-state" role="status">
            {online ? "Loading rows…" : "Waiting for a connection to load rows…"}
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
                  onClick={(event) => {
                    if (event.detail === 0) searchInput.current?.focus();
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
      {rows.length > 10 ? (
        <ListPageNavigation
          labels={{
            navigation: "Record navigation at bottom",
            items: "records",
            back: "Back to filters",
          }}
          pageIndex={pageIndex}
          pageCount={pageCount}
          canPrevious={canPrevious}
          canNext={canNext}
          isBusy={isBusy}
          onBackToFilters={showControls}
          onPageChange={(index) => {
            table.setPageIndex(index);
            showControls();
          }}
        />
      ) : null}
      {dataset === "accounts" ? (
        <CompanyMembership
          accessToken={identity.session.access_token}
          companies={identity.companies}
          row={selectedRow}
          onAddCompany={onAddCompany}
          onClose={() => {
            table.resetRowSelection();
          }}
        />
      ) : (
        <RowDetail
          accessToken={identity.session.access_token}
          isAdministrator={identity.account.access_role === "administrator"}
          companies={companies}
          dataset={dataset}
          row={selectedRow}
          onClose={() => {
            table.resetRowSelection();
          }}
        />
      )}
    </>
  );
}
