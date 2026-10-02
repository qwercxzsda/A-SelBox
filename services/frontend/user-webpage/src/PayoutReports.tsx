import "./FinanceDataset.css";
import "./FinancialTable.css";
import "./PayoutReports.css";
import { Alert, Badge, Button, CloseButton, Group, Text, TextInput } from "@mantine/core";
import type { Identity } from "./auth-session";
import { AppliedTableFilters } from "./AppliedTableFilters";
import { activeFilterCount, normalizeDatasetFilters } from "./dataset-filters";
import { PaginationBar } from "./PaginationBar";
import { PayoutReportsTable } from "./PayoutReportsTable";
import { PayoutStatus } from "./PayoutStatus";
import { RowDetail } from "./RowDetail";
import { UpdateStatus } from "./UpdateStatus";
import { useFinanceTable } from "./use-finance-table";
import { useWorkspacePreference } from "./use-workspace-preference";
import { createPayoutHistoryState, decodePayoutHistoryState } from "./payout-report-view";
import { DATASET_PRESENTATION, getErrorMessage } from "./view-model";
import type { DatasetViewState, ViewStateProps } from "./workspace-view-state";
import { usePayoutReportSelection } from "./use-payout-report-selection";
import { RowsSelect } from "./RowsSelect";

export function PayoutReports({
  identity,
  onRetry,
  viewState,
  onViewStateChange,
  reviewMode = false,
  fixedMonth = false,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  reviewMode?: boolean;
  fixedMonth?: boolean;
} & ViewStateProps<DatasetViewState>) {
  const { table, query, totalCount, search, changeSearch, filters, changeFilters, companies } =
    useFinanceTable(identity, "payouts", viewState, onViewStateChange);
  const [history, setHistory] = useWorkspacePreference(
    reviewMode
      ? `payout-review-history${fixedMonth ? `:${viewState.filters.dateFrom}` : ""}`
      : "payout-report-history",
    createPayoutHistoryState,
    decodePayoutHistoryState,
  );
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows.map((row) => row.original);
  const pageCount = totalCount === null ? null : table.getPageCount();
  const {
    selected,
    selectedScope,
    selectedIsLatest,
    latestForSelection,
    versionQuery,
    selectReport,
    selectVersion,
    restoreSelectionFocus,
  } = usePayoutReportSelection({
    identity,
    rows,
    selectedRowId: viewState.selectedRowId,
    history,
    setHistory,
    onSelect: (selectedRowId) => {
      onViewStateChange((current) => ({ ...current, selectedRowId }));
    },
    restoreFocus: fixedMonth,
  });
  const sort = viewState.sorting[0];
  const visibleFilters = fixedMonth ? { ...filters, dateFrom: "", dateTo: "" } : filters;
  const hasRefinements = activeFilterCount(visibleFilters) > 0 || search.trim().length > 0;

  return (
    <>
      {reviewMode ? (
        <Text mb="sm" role="note" c="dimmed" size="sm">
          Review the supporting records and account controls for a saved report. These details are
          exclusive to administrators and are excluded from the company payout amount.
        </Text>
      ) : null}
      {!fixedMonth ? <PayoutStatus identity={identity} filters={filters} /> : null}
      {query.error ? (
        <Alert color="red" role="alert" mb="md">
          {getErrorMessage(query.error)}
          <Button variant="subtle" disabled={query.isFetching} onClick={() => void onRetry()}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {selectedScope && (versionQuery.isError || (versionQuery.isSuccess && !versionQuery.data)) ? (
        <Alert color="red" mb="md" role="alert">
          {versionQuery.isError
            ? getErrorMessage(versionQuery.error)
            : "This report version is no longer available."}
          <Button variant="subtle" onClick={() => void versionQuery.refetch()}>
            Retry version
          </Button>
          <Button
            variant="subtle"
            onClick={() => {
              selectReport(null);
            }}
          >
            Dismiss
          </Button>
        </Alert>
      ) : null}
      <UpdateStatus active={selectedScope !== null && versionQuery.isPending}>
        Loading selected report version…
      </UpdateStatus>
      <Group className="table-toolbar" justify="space-between" align="end">
        <Group align="end" className="table-toolbar-fields">
          <TextInput
            className="search-field"
            label="Search"
            type="search"
            value={search}
            placeholder={DATASET_PRESENTATION.payouts.searchPlaceholder}
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
          isBusy={query.isFetching}
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
            query.isPending
              ? `Loading reports…`
              : `${String(rows.length === 0 ? 0 : pageIndex * pageSize + 1)}–${String(rows.length === 0 ? 0 : pageIndex * pageSize + rows.length)} of ${totalCount?.toLocaleString("en-US") ?? "—"} latest reports`
          }
        />
      </Group>
      <AppliedTableFilters
        dataset="payouts"
        filters={visibleFilters}
        companies={companies}
        onChange={changeFilters}
      />
      <PayoutReportsTable
        fixedMonth={fixedMonth}
        identity={identity}
        rows={rows}
        companies={companies}
        filters={filters}
        onFiltersChange={changeFilters}
        sort={{ column: sort.id, direction: sort.desc ? "desc" : "asc" }}
        onSortChange={({ column: id, direction }) => {
          table.setSorting([{ id, desc: direction === "desc" }]);
        }}
        totalCount={totalCount}
        isBusy={query.isFetching}
        history={history}
        onToggleHistory={(key) => {
          setHistory((current) => ({
            ...current,
            expanded: current.expanded.includes(key)
              ? current.expanded.filter((value) => value !== key)
              : [...current.expanded, key],
          }));
          selectReport(null);
        }}
        onHistoryPageChange={(key, page) => {
          setHistory((current) => ({ ...current, pages: { ...current.pages, [key]: page } }));
          selectReport(null);
        }}
        selectedRowId={viewState.selectedRowId}
        onSelect={selectReport}
        onSelectVersion={selectVersion}
        status={
          query.countQuery.isError ? (
            <>
              <Text size="xs" c="red" role="status">
                Report count unavailable.
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
            <UpdateStatus active={query.countQuery.isFetching}>Counting reports…</UpdateStatus>
          )
        }
      >
        {query.isPending ? (
          <div className="loading-state" role="status">
            Loading reports…
          </div>
        ) : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <div className="empty-state">
            <Text fw={600}>{hasRefinements ? "No matching reports" : "No payout reports yet"}</Text>
            <Text c="dimmed" size="sm">
              {hasRefinements
                ? "Adjust the column filters or search to find a report."
                : "Reports will appear automatically once a month is mature and its required data is available."}
            </Text>
            {hasRefinements ? (
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
            ) : null}
          </div>
        ) : null}
      </PayoutReportsTable>
      <RowDetail
        stackId={fixedMonth && reviewMode ? "financial-review-snapshot" : undefined}
        onExitTransitionEnd={fixedMonth ? restoreSelectionFocus : undefined}
        accessToken={identity.session.access_token}
        isAdministrator={identity.account.access_role === "operator"}
        companies={companies}
        dataset="payouts"
        row={selected}
        reviewMode={reviewMode}
        onClose={() => {
          selectReport(null);
        }}
        reportNavigation={
          selectedIsLatest ? (
            <Badge variant="light" color="teal" mb="lg">
              Latest version
            </Badge>
          ) : (
            <Group className="payout-version-navigation" mb="lg" justify="space-between">
              <Badge color="gray" variant="light">
                {latestForSelection ? "Previous version" : "Saved version"}
              </Badge>
              {latestForSelection ? (
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    selectVersion(latestForSelection);
                  }}
                >
                  Open latest version
                </Button>
              ) : null}
            </Group>
          )
        }
      />
    </>
  );
}
