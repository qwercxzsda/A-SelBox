import { useRef } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewMonths } from "./api";
import type { Identity } from "./auth-session";
import { PaginationBar } from "./PaginationBar";
import { FinancialReviewMonthDetail } from "./FinancialReviewMonthDetail";
import { FinancialReviewMonthTable } from "./FinancialReviewMonthTable";
import { formatRecordMonth } from "./date-display";
import {
  createMonthlyReviewView,
  decodeMonthlyReviewView,
  groupFinancialReviewMonths,
} from "./financial-review-view";
import { useWorkspacePreference } from "./use-workspace-preference";
import { usePayoutPolicy } from "./use-payout-policy";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { REVIEW_CATEGORIES, type ReviewCategory } from "./financial-review-categories";
import { RowsSelect } from "./RowsSelect";
import "./FinanceDataset.css";
import "./FinancialTable.css";
import "./FinancialReview.css";

export function FinancialReviewMonths({
  identity,
  category,
  onRetry,
}: {
  identity: Identity;
  category: ReviewCategory;
  onRetry: () => Promise<void>;
}) {
  const policy = usePayoutPolicy(identity);
  const matureCutoff = policy.data?.mature_cutoff_date ?? "";
  const [view, setView] = useWorkspacePreference(
    `financial-review:monthly-summaries:${category}`,
    createMonthlyReviewView,
    decodeMonthlyReviewView,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const cursor = view.cursors[view.pageIndex] ?? null;
  const query = useQuery({
    queryKey: [
      "financial-review",
      "months",
      identity.session.user.id,
      identity.account.access_role,
      matureCutoff,
      cursor,
      view.pageSize,
      view.filterMonth,
      category,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewMonths(
        identity.session.access_token,
        category,
        cursor,
        view.pageSize,
        view.filterMonth,
        signal,
      ),
    enabled: matureCutoff !== "",
    staleTime: Infinity,
  });
  const rows = query.data?.rows ?? [];
  const months = groupFinancialReviewMonths(rows).map(({ month }) => month);
  const firstRow = rows.length ? view.pageIndex * view.pageSize + 1 : 0;
  const lastRow = rows.length ? view.pageIndex * view.pageSize + rows.length : 0;
  function selectMonth(month: string | null) {
    setView((current) => ({ ...current, selectedMonth: month }));
  }
  function filterMonth(month: string) {
    setView((current) => ({
      ...createMonthlyReviewView(),
      pageSize: current.pageSize,
      filterMonth: month,
    }));
  }
  function changePage(forward: boolean) {
    const next = query.data?.nextCursor ?? null;
    if (forward && !next) return;
    setView((current) => ({
      ...current,
      cursors: forward
        ? [...current.cursors.slice(0, current.pageIndex + 1), next]
        : current.cursors,
      pageIndex: Math.max(0, current.pageIndex + (forward ? 1 : -1)),
      selectedMonth: null,
    }));
    listRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function pagination(bottom = false) {
    return (
      <PaginationBar
        ariaLabel={`Monthly summaries pagination${bottom ? " at bottom" : ""}`}
        pageIndex={view.pageIndex}
        pageCount={query.isSuccess && !query.data.nextCursor ? view.pageIndex + 1 : null}
        canPrevious={view.pageIndex > 0}
        canNext={Boolean(query.data?.nextCursor)}
        isBusy={query.isFetching}
        summary={
          query.isPending
            ? "Loading rows…"
            : `${String(firstRow)}–${String(lastRow)}${query.isSuccess && !query.data.nextCursor ? ` of ${String(lastRow)}` : ""} rows`
        }
        onPrevious={() => {
          changePage(false);
        }}
        onNext={() => {
          changePage(true);
        }}
      />
    );
  }
  return (
    <div ref={listRef} className="financial-review-months">
      <WorkspaceIntro
        description={
          <>
            {REVIEW_CATEGORIES.find(({ value }) => value === category)?.description} Across all
            source accounts and companies; currencies remain separate.{" "}
            {matureCutoff
              ? `Includes mature dates before ${matureCutoff} (UTC).`
              : "Checking available months…"}
          </>
        }
      />
      {policy.isError && !matureCutoff ? (
        <Alert color="red" role="alert" mb="sm">
          Could not load available review months.
          <Button variant="subtle" onClick={() => void policy.refetch()}>
            Retry available months
          </Button>
        </Alert>
      ) : (
        <>
          <Group className="table-toolbar" justify="space-between" align="end">
            <RowsSelect
              value={view.pageSize}
              onChange={(pageSize) => {
                setView((current) => ({
                  ...createMonthlyReviewView(),
                  pageSize,
                  filterMonth: current.filterMonth,
                }));
              }}
            />
            {pagination()}
          </Group>
          {view.filterMonth ? (
            <Group
              className="applied-table-filters"
              role="group"
              aria-label="Applied review filters"
              gap="xs"
              mb="xs"
            >
              <Text size="xs" c="dimmed">
                1 filter applied
              </Text>
              <Button
                className="applied-table-filter"
                size="compact-xs"
                variant="light"
                aria-label={`Clear month filter: ${formatRecordMonth(view.filterMonth)}`}
                onClick={() => {
                  filterMonth("");
                }}
                rightSection={<span aria-hidden="true">×</span>}
              >
                <span className="applied-table-filter-text">
                  Month: {formatRecordMonth(view.filterMonth)}
                </span>
              </Button>
            </Group>
          ) : null}
          {query.isError ? (
            <Alert role="alert" color="red" mb="sm">
              Could not load monthly summaries.
              <Button
                variant="subtle"
                size="xs"
                onClick={() => void query.refetch()}
                aria-label="Retry monthly summaries"
              >
                Retry
              </Button>
            </Alert>
          ) : null}
          <FinancialReviewMonthTable
            category={category}
            rows={rows}
            selectedMonth={view.selectedMonth}
            onSelect={selectMonth}
            filterMonth={view.filterMonth}
            onFilterMonth={filterMonth}
            matureCutoff={matureCutoff}
            isBusy={query.isFetching}
            emptyMessage={
              query.isPending
                ? "Loading monthly summaries…"
                : query.isError
                  ? "Monthly summaries are unavailable."
                  : `No source data available for ${view.filterMonth ? formatRecordMonth(view.filterMonth) : "these months"}.`
            }
          />
          {rows.length > 10 ? pagination(true) : null}
        </>
      )}
      <FinancialReviewMonthDetail
        category={category}
        onRetry={onRetry}
        identity={identity}
        month={view.selectedMonth}
        matureCutoff={matureCutoff}
        months={months}
        onSelect={selectMonth}
        onClose={() => {
          selectMonth(null);
        }}
      />
    </div>
  );
}
