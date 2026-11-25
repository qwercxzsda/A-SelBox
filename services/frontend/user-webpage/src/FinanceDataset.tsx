import "./FinanceDataset.css";
import { Alert, Button, Group, Text } from "@mantine/core";
import { type TableDatasetKey, DATASET_CONFIG } from "./api";
import { DatasetRecordDrawer } from "./DatasetRecordDrawer";
import { DatasetTable } from "./DatasetTable";
import { useFinanceTable } from "./use-finance-table";
import { DATASET_PRESENTATION } from "./view-model";
import type { Identity } from "./auth-session";
import type { CorrectableViewStateProps, DatasetViewState } from "./workspace-view-state";
import { AmountOrderingLimitError } from "./api/amount-ordering";
import { PayoutReports } from "./PayoutReports";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { DatasetHelp } from "./DatasetHelp";
import { TransactionSummaries } from "./TransactionSummaries";
import { useEffect, useRef, useState } from "react";
import { FinancialSourceLookup } from "./FinancialSourceLookup";
import { ListPageNavigation } from "./ListPageNavigation";
import { ListToolbar } from "./ListToolbar";
import { revealSection } from "./reveal-section";
import { ErrorAlert } from "./ErrorAlert";
import { loadErrorDetail } from "./load-error";
import { showsBottomPager } from "./pagination";
import type { LoadingState } from "./LoadingStatus";
import { useListHold } from "./scroll-hold";

interface FinanceDatasetProps extends CorrectableViewStateProps<DatasetViewState> {
  identity: Identity;
  dataset: TableDatasetKey;
  onRetry: () => Promise<void>;
  onAddCompany?: () => void;
  onShowTransactions?: (sku: string) => void;
  updating?: boolean;
  /** Embedded under a parent header (Raw data): report the loading status instead of a header. */
  onStatusChange?: (status: LoadingState) => void;
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
  onViewStateCorrect,
  onAddCompany,
  onShowTransactions,
  updating = false,
  onStatusChange,
}: FinanceDatasetProps) {
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const summariesRef = useRef<HTMLDivElement>(null);
  const summaryGap = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listHold = useListHold(summariesRef, toolbarRef, summaryGap);
  const list = useFinanceTable(identity, dataset, viewState, {
    onViewStateChange,
    onViewStateCorrect,
  });
  const {
    table,
    query,
    totalCount,
    search,
    debouncedSearch,
    changeSearch,
    filters,
    changeFilters,
  } = list;
  const { pageIndex, pageSize } = table.state.pagination;
  const rows = table.getRowModel().rows;
  const presentation = DATASET_PRESENTATION[dataset];
  const pageCount = totalCount === null ? null : table.getPageCount();
  const canPrevious = table.getCanPreviousPage();
  const canNext = totalCount === null ? rows.length === pageSize : table.getCanNextPage();
  const isBusy = query.isFetching;
  const selectedRow = table.getSelectedRowModel().rows[0]?.original ?? null;
  const amountLimitExceeded = query.error instanceof AmountOrderingLimitError;
  const status: LoadingState = query.isPending
    ? "loading"
    : query.isFetching || query.countQuery.isFetching || updating
      ? "updating"
      : null;
  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);
  function showControls() {
    revealSection(toolbarRef.current);
  }
  return (
    <>
      {onStatusChange ? null : (
        <WorkspaceHeader
          title={presentation.label}
          status={status}
          help={<DatasetHelp dataset={dataset} />}
          actions={
            dataset === "accounts" && onAddCompany ? (
              <Button variant="light" onClick={onAddCompany}>
                Add company
              </Button>
            ) : undefined
          }
        />
      )}
      {dataset === "live" ? (
        <>
          <div
            ref={summariesRef}
            className="transaction-summary-region"
            tabIndex={-1}
            role="region"
            aria-label="Transaction summary"
          >
            <TransactionSummaries
              identity={identity}
              onRetry={onRetry}
              filters={filters}
              search={debouncedSearch}
              onShowFilters={() => {
                showControls();
                searchInput.current?.focus({ preventScroll: true });
              }}
              onPeriodSelect={({ from, to }) => {
                changeFilters({ dateFrom: from, dateTo: to });
              }}
            />
          </div>
          <div ref={summaryGap} className="transaction-summary-gap" aria-hidden="true" />
        </>
      ) : null}
      <div className="finance-dataset-list" {...listHold}>
        <DatasetAlerts
          savedNotice={savedNotice}
          loadSubject={presentation.loadSubject}
          error={query.error}
          retrying={isBusy}
          onRetry={() => void onRetry()}
          onOrderByDate={() => {
            const defaultSort = DATASET_CONFIG[dataset].defaultSort;
            table.setSorting([{ id: defaultSort.column, desc: true }]);
          }}
        />
        <ListToolbar
          controlsRef={toolbarRef}
          label={dataset === "accounts" ? "Account controls" : "Record controls"}
          search={{
            inputRef: searchInput,
            value: search,
            placeholder: presentation.searchPlaceholder,
            onChange: changeSearch,
          }}
          pageSize={pageSize}
          onPageSizeChange={(pageSize) => {
            table.setPagination({ pageIndex: 0, pageSize });
          }}
          extraControls={
            dataset === "finances" ? (
              <FinancialSourceLookup identity={identity} />
            ) : dataset === "live" ? (
              <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                  revealSection(summariesRef.current);
                }}
              >
                <span aria-hidden="true">↑ </span> Back to summaries
              </Button>
            ) : undefined
          }
          pagination={{
            pageIndex,
            pageCount,
            canPrevious,
            canNext,
            isBusy,
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
          items={presentation.items}
          updating={query.isPlaceholderData}
          message={
            amountLimitExceeded
              ? `${sentenceCase(presentation.items)} not loaded`
              : query.isPending
                ? ""
                : undefined
          }
        />
        <DatasetTable
          identity={identity}
          dataset={dataset}
          list={list}
          searchInput={searchInput}
          onCountRetry={() => {
            showControls();
            void query.countQuery.refetch();
          }}
        />
        {showsBottomPager(rows.length, pageIndex) ? (
          <ListPageNavigation
            labels={{
              navigation: "Record navigation at bottom",
              items: presentation.items,
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
        <DatasetRecordDrawer
          identity={identity}
          dataset={dataset}
          row={selectedRow}
          companies={list.companies}
          onAddCompany={onAddCompany}
          onShowTransactions={onShowTransactions}
          onClose={() => {
            table.resetRowSelection();
          }}
          onSaved={(notice) => {
            setSavedNotice(notice);
            table.resetRowSelection();
          }}
        />
      </div>
    </>
  );
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A saved change, an amount order over its limit (with the date order instead), or a load error. */
function DatasetAlerts({
  savedNotice,
  loadSubject,
  error,
  retrying,
  onRetry,
  onOrderByDate,
}: {
  savedNotice: string | null;
  loadSubject: string;
  error: Error | null;
  retrying: boolean;
  onRetry: () => void;
  onOrderByDate: () => void;
}) {
  return (
    <>
      {savedNotice ? (
        <Alert color="green" role="status" mb="md">
          {savedNotice}
        </Alert>
      ) : null}
      {error instanceof AmountOrderingLimitError ? (
        <Alert color="orange" role="alert" mb="md">
          <Group justify="space-between" gap="xs">
            <Text size="sm">{error.message}</Text>
            <Button variant="subtle" size="compact-sm" onClick={onOrderByDate}>
              Order by date
            </Button>
          </Group>
        </Alert>
      ) : error ? (
        <ErrorAlert
          title={`Could not load ${loadSubject}`}
          detail={loadErrorDetail(error)}
          retrying={retrying}
          onRetry={onRetry}
        />
      ) : null}
    </>
  );
}
