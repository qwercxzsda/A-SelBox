import "./FinanceDataset.css";
import "./FinancialTable.css";
import "./PayoutReports.css";
import { useRef } from "react";
import { Alert, Badge, Button, Group, Text } from "@mantine/core";
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
import { SearchInput } from "./SearchInput";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { DatasetCountStatus } from "./DatasetCountStatus";
import { pageRangeSummary } from "./pagination";
import { reviewPeriodKey } from "./financial-review-scope-key";

export function PayoutReports({
  identity,
  onRetry,
  viewState,
  onViewStateChange,
  reviewMode = false,
  fixedMonth = false,
  currency,
  marketplace,
  onConfigureSku,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  reviewMode?: boolean;
  fixedMonth?: boolean;
  currency?: string;
  marketplace?: string;
  onConfigureSku?: (sku: string) => void;
} & ViewStateProps<DatasetViewState>) {
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const reviewKey = reviewPeriodKey(
    viewState.filters.dateFrom.slice(0, 7),
    marketplace ?? "",
    currency ?? "",
  );
  const scopedViewState = {
    ...viewState,
    filters: {
      ...viewState.filters,
      marketplaces: marketplace === undefined ? viewState.filters.marketplaces : [marketplace],
    },
  };
  const { table, query, totalCount, search, changeSearch, filters, changeFilters, companies } =
    useFinanceTable(identity, "payouts", scopedViewState, onViewStateChange, currency);
  const [history, setHistory] = useWorkspacePreference(
    reviewMode
      ? `payout-review-history${fixedMonth ? `:${reviewKey}` : ""}`
      : "payout-report-history",
    createPayoutHistoryState,
    decodePayoutHistoryState,
  );
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows.map((row) => row.original);
  const pageCount = totalCount === null ? null : table.getPageCount();
  const canPrevious = table.getCanPreviousPage();
  const canNext = totalCount === null ? rows.length === pageSize : table.getCanNextPage();
  function showControls() {
    revealSection(controlsRef.current);
  }
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
    fallbackRef: controlsRef,
  });
  function restoreReportFocus() {
    restoreSelectionFocus();
    if (document.activeElement === controlsRef.current) revealSection(controlsRef.current);
  }
  const sort = viewState.sorting[0];
  const visibleFilters = {
    ...filters,
    ...(fixedMonth ? { dateFrom: "", dateTo: "" } : {}),
    ...(marketplace !== undefined ? { marketplaces: [] } : {}),
  };
  const hasRefinements = activeFilterCount(visibleFilters) > 0 || search.trim().length > 0;

  return (
    <>
      {reviewMode ? (
        <Text mb="sm" role="note" c="dimmed" size="sm">
          Review the supporting records and account controls for a saved report. These details are
          exclusive to administrators and are excluded from the company payout amount.
        </Text>
      ) : null}
      <Text size="xs" c="dimmed" mb="sm">
        Reports are separate for each company, month, and marketplace. Currencies remain separate
        amount units.
      </Text>
      <PayoutStatus
        identity={identity}
        filters={filters}
        compact={fixedMonth}
        onConfigureSku={onConfigureSku}
      />
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
      <Group
        ref={controlsRef}
        tabIndex={-1}
        role="group"
        aria-label="Payout report controls"
        className="table-toolbar"
        justify="space-between"
        align="end"
        style={{
          scrollMarginTop: fixedMonth
            ? "calc(var(--ui-drawer-content-header-height, var(--ui-drawer-header-height)) + 16px)"
            : 16,
        }}
      >
        <Group align="end" className="table-toolbar-fields">
          <SearchInput
            inputRef={searchInput}
            className="search-field"
            label="Search"
            type="search"
            value={search}
            placeholder={DATASET_PRESENTATION.payouts.searchPlaceholder}
            onChange={changeSearch}
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
          canPrevious={canPrevious}
          canNext={canNext}
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
              ? "Loading reports…"
              : pageRangeSummary(pageIndex, pageSize, rows.length, totalCount, "latest reports")
          }
        />
      </Group>
      <AppliedTableFilters
        focusTarget={searchInput}
        dataset="payouts"
        filters={visibleFilters}
        companies={companies}
        onChange={changeFilters}
      />
      <PayoutReportsTable
        fixedMonth={fixedMonth}
        fixedMarketplace={marketplace !== undefined}
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
          <DatasetCountStatus
            isError={query.countQuery.isError}
            isFetching={query.countQuery.isFetching}
            items="reports"
            onRetry={() => {
              showControls();
              void query.countQuery.refetch();
            }}
          />
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
                ? "Check readiness above for pending or blocked months, or adjust the column filters and search."
                : "Reports will appear automatically once a month is mature and its required data is available."}
            </Text>
            {hasRefinements ? (
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
            ) : null}
          </div>
        ) : null}
      </PayoutReportsTable>
      {rows.length > 10 || pageIndex > 0 ? (
        <ListPageNavigation
          labels={{
            navigation: "Payout report navigation at bottom",
            items: "reports",
            back: "Back to report filters",
          }}
          pageIndex={pageIndex}
          pageCount={pageCount}
          canPrevious={canPrevious}
          canNext={canNext}
          isBusy={query.isFetching}
          onBackToFilters={showControls}
          onPageChange={(index) => {
            table.setPageIndex(index);
            showControls();
          }}
        />
      ) : null}
      <RowDetail
        stackId={fixedMonth && reviewMode ? "financial-review-snapshot" : undefined}
        onExitTransitionEnd={fixedMonth ? restoreReportFocus : undefined}
        accessToken={identity.session.access_token}
        isAdministrator={identity.account.access_role === "administrator"}
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
