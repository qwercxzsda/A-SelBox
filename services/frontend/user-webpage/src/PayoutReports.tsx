import "./PayoutReports.css";
import { useRef } from "react";
import { Button, Group } from "@mantine/core";
import { StatusBadge } from "./StatusBadge";
import type { Identity } from "./auth-session";
import { AppliedTableFilters } from "./AppliedTableFilters";
import { PayoutReportsTable } from "./PayoutReportsTable";
import { RowDetail } from "./RowDetail";
import { useFinanceTable } from "./use-finance-table";
import { useWorkspacePreference } from "./use-workspace-preference";
import { createPayoutHistoryState, decodePayoutHistoryState } from "./payout-report-view";
import { DATASET_PRESENTATION } from "./view-model";
import type { CorrectableViewStateProps, DatasetViewState } from "./workspace-view-state";
import { usePayoutReportSelection } from "./use-payout-report-selection";
import { ListPageNavigation } from "./ListPageNavigation";
import { revealSection } from "./reveal-section";
import { DatasetCountStatus } from "./DatasetCountStatus";
import { ListToolbar } from "./ListToolbar";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { DatasetHelp } from "./DatasetHelp";
import { EmptyState } from "./EmptyState";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";
import { showsBottomPager } from "./pagination";

export function PayoutReports({
  identity,
  onRetry,
  viewState,
  onViewStateChange,
  onViewStateCorrect,
  updating = false,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  updating?: boolean;
} & CorrectableViewStateProps<DatasetViewState>) {
  const searchInput = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const {
    table,
    query,
    totalCount,
    search,
    changeSearch,
    filters,
    changeFilters,
    hasRefinements,
    resetSearchAndFilters,
    companies,
  } = useFinanceTable(identity, "payouts", viewState, { onViewStateChange, onViewStateCorrect });
  const [history, setHistory] = useWorkspacePreference(
    "payout-report-history",
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
  } = usePayoutReportSelection({
    identity,
    rows,
    selectedRowId: viewState.selectedRowId,
    history,
    setHistory,
    onSelect: (selectedRowId) => {
      onViewStateChange((current) => ({ ...current, selectedRowId }));
    },
    restoreFocus: false,
    fallbackRef: controlsRef,
  });
  const sort = viewState.sorting[0];

  return (
    <>
      <WorkspaceHeader
        title="Payout reports"
        help={<DatasetHelp dataset="payouts" />}
        status={
          query.isPending
            ? "loading"
            : query.isFetching ||
                query.countQuery.isFetching ||
                (selectedScope !== null && versionQuery.isFetching) ||
                updating
              ? "updating"
              : null
        }
      />
      {query.error ? (
        <ErrorAlert
          title={`Could not load ${DATASET_PRESENTATION.payouts.loadSubject}`}
          detail={loadErrorDetail(query.error)}
          retrying={query.isFetching}
          onRetry={() => void onRetry()}
        />
      ) : null}
      {selectedScope && (versionQuery.isError || (versionQuery.isSuccess && !versionQuery.data)) ? (
        <ErrorAlert
          title="Could not load the report version"
          detail={
            versionQuery.isError
              ? loadErrorDetail(versionQuery.error)
              : "This version is no longer available."
          }
          retrying={versionQuery.isFetching}
          onRetry={() => void versionQuery.refetch()}
          onDismiss={() => {
            selectReport(null);
          }}
        />
      ) : null}
      <ListToolbar
        controlsRef={controlsRef}
        label="Payout report controls"
        search={{
          inputRef: searchInput,
          value: search,
          placeholder: DATASET_PRESENTATION.payouts.searchPlaceholder,
          onChange: changeSearch,
        }}
        pageSize={pageSize}
        onPageSizeChange={(pageSize) => {
          table.setPagination({ pageIndex: 0, pageSize });
        }}
        pagination={{
          pageIndex,
          pageCount,
          canPrevious,
          canNext,
          isBusy: query.isFetching,
          onPrevious: () => {
            table.previousPage();
          },
          onNext: () => {
            table.nextPage();
          },
          onPageChange: (pageIndex) => {
            table.setPageIndex(pageIndex);
          },
        }}
        rowCount={rows.length}
        totalCount={totalCount}
        items={DATASET_PRESENTATION.payouts.items}
        updating={query.isPlaceholderData}
        message={query.isPending ? "" : undefined}
      />
      <PayoutReportsTable
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
        isPlaceholderData={query.isPlaceholderData}
        appliedFilters={
          <AppliedTableFilters
            focusTarget={searchInput}
            dataset="payouts"
            filters={filters}
            companies={companies}
            onChange={changeFilters}
          />
        }
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
            onRetry={() => {
              showControls();
              void query.countQuery.refetch();
            }}
          />
        }
      >
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <EmptyState
            title={
              hasRefinements
                ? DATASET_PRESENTATION.payouts.noMatchMessage
                : DATASET_PRESENTATION.payouts.emptyMessage
            }
            action={
              hasRefinements
                ? {
                    label: "Reset search and filters",
                    focusTarget: searchInput,
                    onClick: resetSearchAndFilters,
                  }
                : undefined
            }
          />
        ) : null}
      </PayoutReportsTable>
      {showsBottomPager(rows.length, pageIndex) ? (
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
        accessToken={identity.session.access_token}
        isAdministrator={identity.account.access_role === "administrator"}
        companies={companies}
        dataset="payouts"
        row={selected}
        onClose={() => {
          selectReport(null);
        }}
        reportNavigation={
          selectedIsLatest ? (
            <Group className="payout-version-navigation" mb="lg">
              <StatusBadge tone="success">Latest version</StatusBadge>
            </Group>
          ) : (
            <Group className="payout-version-navigation" mb="lg" justify="space-between">
              <StatusBadge tone="neutral">
                {latestForSelection ? "Previous version" : "Saved version"}
              </StatusBadge>
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
