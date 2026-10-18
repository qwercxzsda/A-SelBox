import { useRef } from "react";
import { Alert, Button, Group, NativeSelect, Text } from "@mantine/core";
import type { Identity } from "./auth-session";
import { FinancialReviewMonthDetail } from "./FinancialReviewMonthDetail";
import { FinancialReviewMonthTable } from "./FinancialReviewMonthTable";
import { FinancialReviewSummary } from "./FinancialReviewSummary";
import { FinancialReviewTrend } from "./FinancialReviewTrend";
import { formatRecordMonth } from "./date-display";
import {
  createMonthlyReviewView,
  decodeMonthlyReviewView,
  type ReviewScope,
} from "./financial-review-view";
import { useWorkspacePreference } from "./use-workspace-preference";
import { useFinancialReviewPeriod } from "./use-financial-review-period";
import { useDrawerFocusReturn } from "./use-drawer-focus-return";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { REVIEW_CATEGORIES, type ReviewCategory } from "./financial-review-categories";
import "./FinancialTable.css";
import "./FinancialReview.css";

export function FinancialReviewMonths({
  identity,
  category,
  scope,
  onScopeChange,
  onRetry,
}: {
  identity: Identity;
  category: ReviewCategory;
  scope: ReviewScope;
  onScopeChange: (scope: ReviewScope) => void;
  onRetry: () => Promise<void>;
}) {
  const {
    policy,
    bounds,
    query,
    matureCutoff,
    latestMonth,
    year,
    years,
    currencies,
    rows,
    months,
    loading,
  } = useFinancialReviewPeriod(identity, category, scope);
  const [view, setView] = useWorkspacePreference(
    `financial-review:monthly-summaries:${category}`,
    createMonthlyReviewView,
    decodeMonthlyReviewView,
  );
  const listRef = useRef<HTMLDivElement>(null);
  const selectedMonth = months.includes(view.selectedMonth ?? "") ? view.selectedMonth : null;
  const { rememberOpener, restoreFocus } = useDrawerFocusReturn({
    opened: selectedMonth !== null,
    fallbackRef: listRef,
  });

  function selectMonth(month: string | null) {
    if (month) rememberOpener();
    setView({ selectedMonth: month });
  }
  function changeScope(next: ReviewScope) {
    setView({ selectedMonth: null });
    onScopeChange(next);
  }

  return (
    <div ref={listRef} className="financial-review-months" tabIndex={-1}>
      <WorkspaceIntro
        description={REVIEW_CATEGORIES.find(({ value }) => value === category)?.description}
      />
      <Group className="financial-review-scope" justify="space-between" align="end" gap="md">
        <Group gap="sm" align="end">
          <NativeSelect
            label="Year"
            value={year}
            data={years.length ? years : [{ value: "", label: loading ? "Loading…" : "No years" }]}
            disabled={!years.length}
            onChange={(event) => {
              changeScope({ ...scope, year: event.currentTarget.value });
            }}
          />
          <NativeSelect
            label="Currency"
            value={scope.currency}
            data={currencies}
            onChange={(event) => {
              changeScope({ year, currency: event.currentTarget.value });
            }}
          />
        </Group>
        <Text size="xs" c="dimmed" className="financial-review-scope-note">
          {latestMonth
            ? `Full mature months through ${formatRecordMonth(latestMonth)}`
            : "Checking mature months…"}
          <br />
          All source accounts and companies
        </Text>
      </Group>
      {policy.isError || bounds.isError ? (
        <Alert color="red" role="alert" mb="sm">
          Could not load available review periods.
          <Button
            variant="subtle"
            onClick={() => {
              void policy.refetch();
              void bounds.refetch();
            }}
          >
            Retry available months
          </Button>
        </Alert>
      ) : null}
      {query.isError ? (
        <Alert role="alert" color="red" mb="sm">
          Could not load monthly summaries.
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Retry monthly summaries
          </Button>
        </Alert>
      ) : null}
      {rows.length ? (
        <>
          <FinancialReviewSummary rows={rows} currency={scope.currency} year={year} />
          <FinancialReviewTrend rows={rows} currency={scope.currency} onSelect={selectMonth} />
        </>
      ) : null}
      <FinancialReviewMonthTable
        category={category}
        currency={scope.currency}
        rows={rows}
        selectedMonth={selectedMonth}
        onSelect={selectMonth}
        isBusy={loading || query.isFetching}
        emptyMessage={
          loading
            ? "Loading monthly summaries…"
            : query.isError || bounds.isError || policy.isError
              ? "Monthly summaries are unavailable."
              : `No mature source records for ${scope.currency}${year ? ` in ${year}` : ""}.`
        }
      />
      <FinancialReviewMonthDetail
        category={category}
        currency={scope.currency}
        onRetry={onRetry}
        identity={identity}
        month={selectedMonth}
        matureCutoff={matureCutoff}
        latestMonth={latestMonth}
        months={months}
        onSelect={selectMonth}
        onExitTransitionEnd={restoreFocus}
        onClose={() => {
          selectMonth(null);
        }}
      />
    </div>
  );
}
