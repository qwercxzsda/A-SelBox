import { useRef } from "react";
import { Alert, Badge, Button, Group, NativeSelect, Text } from "@mantine/core";
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
import { revealSection } from "./reveal-section";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { FeeFamilyFilter, FeeFamilyScope } from "./FeeFamilyFilter";
import { FinancialReviewFamilyBreakdown } from "./FinancialReviewFamilies";
import { normalizeFeeFamilyIds } from "./fee-family-catalog";
import { REVIEW_CATEGORIES, type ReviewCategory } from "./financial-review-categories";
import marketplaces from "./generated/marketplaces.json";
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
    bounds,
    comparisonQuery,
    totalsQuery,
    sourceTotals,
    familyQuery,
    familyTypes,
    familyOptions,
    latestMonth,
    year,
    years,
    currencies,
    currency,
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
    setView({ selectedMonth: month, ...(month && currency ? { currency } : {}) });
  }
  function changeScope(next: ReviewScope) {
    setView({ selectedMonth: null });
    onScopeChange(next);
  }
  const hasSelectedFamilies = scope.families.length > 0;
  const comparisonUnavailable =
    comparisonQuery.isError || bounds.isError || (!currency && totalsQuery.isError);
  const canClearFamilies = hasSelectedFamilies && !loading && !comparisonUnavailable;
  const emptyMessage = loading
    ? "Loading monthly summaries…"
    : comparisonUnavailable
      ? "Monthly summaries are unavailable."
      : hasSelectedFamilies
        ? `No source records match the selected fee families for ${scope.marketplace}${currency ? ` in ${currency}` : ""}${year ? ` for ${year}` : ""}.`
        : `No source records for ${scope.marketplace}${currency ? ` in ${currency}` : ""}${year ? ` in ${year}` : ""}.`;

  return (
    <div ref={listRef} className="financial-review-months" tabIndex={-1}>
      <WorkspaceIntro
        description={REVIEW_CATEGORIES.find(({ value }) => value === category)?.description}
      />
      <Group className="financial-review-scope" justify="space-between" align="end" gap="md">
        <Group gap="sm" align="end">
          <NativeSelect
            label="Marketplace"
            value={scope.marketplace}
            data={marketplaces}
            onChange={(event) => {
              changeScope({ ...scope, marketplace: event.currentTarget.value, currency: "" });
            }}
          />
          <NativeSelect
            label="Year"
            value={year}
            data={years.length ? years : [{ value: "", label: loading ? "Loading…" : "No years" }]}
            disabled={!years.length}
            onChange={(event) => {
              changeScope({ ...scope, year: event.currentTarget.value });
            }}
          />
          {currencies.length > 1 ? (
            <NativeSelect
              label="Currency"
              description="Amounts stay separate by currency"
              value={currency}
              data={currencies}
              onChange={(event) => {
                changeScope({ ...scope, year, currency: event.currentTarget.value });
              }}
            />
          ) : currency ? (
            <Badge variant="light" aria-label={`Amount currency: ${currency}`}>
              {currency}
            </Badge>
          ) : null}
          <FeeFamilyFilter
            families={scope.families}
            options={familyOptions}
            loading={year !== "" && currency !== "" && familyQuery.isPending}
            error={familyQuery.isError}
            onChange={(families) => {
              changeScope({ ...scope, currency, families: normalizeFeeFamilyIds(families) });
            }}
            onRetry={() => void familyQuery.refetch()}
          />
        </Group>
        <Text size="xs" c="dimmed" className="financial-review-scope-note">
          {latestMonth
            ? `Source records through ${formatRecordMonth(latestMonth)}`
            : bounds.isError
              ? "Available source months unavailable"
              : bounds.isPending
                ? "Checking available source months…"
                : "No source months available"}
          <br />
          {scope.marketplace} · All source accounts and companies
        </Text>
      </Group>
      <div className="financial-review-family-context">
        <FeeFamilyScope families={scope.families} />
        <Text size="xs" c="dimmed">
          The selected families apply to period totals, monthly and running differences, and source
          records.
        </Text>
      </div>
      {bounds.isError ? (
        <Alert color="red" role="alert" mb="sm">
          Could not load available review periods.
          <Button
            variant="subtle"
            onClick={() => {
              revealSection(listRef.current);
              void bounds.refetch();
            }}
          >
            Retry available months
          </Button>
        </Alert>
      ) : null}
      {hasSelectedFamilies && totalsQuery.isError ? (
        <Alert role="alert" color="red" mb="sm">
          Could not load source coverage and available currencies.
          <Button
            variant="subtle"
            onClick={() => {
              revealSection(listRef.current);
              void totalsQuery.refetch();
            }}
          >
            Retry source totals
          </Button>
        </Alert>
      ) : null}
      {comparisonQuery.isError && !hasSelectedFamilies ? (
        <Alert role="alert" color="red" mb="sm">
          Could not load monthly summaries.
          <Button
            variant="subtle"
            onClick={() => {
              revealSection(listRef.current);
              void comparisonQuery.refetch();
            }}
          >
            Retry monthly summaries
          </Button>
        </Alert>
      ) : null}
      {rows.length ? (
        <>
          <FinancialReviewSummary rows={rows} currency={currency} year={year} />
          <FinancialReviewTrend
            rows={rows}
            currency={currency}
            families={scope.families}
            familyTypes={familyTypes}
            familyLoading={
              familyQuery.isPending || familyQuery.isFetching || totalsQuery.isFetching
            }
            familyError={familyQuery.isError}
            onRetryFamilies={() => {
              void totalsQuery.refetch();
              void familyQuery.refetch();
            }}
            onSelect={selectMonth}
          />
        </>
      ) : null}
      {year && currency ? (
        <FinancialReviewFamilyBreakdown
          query={familyQuery}
          sourceTotals={sourceTotals}
          sourceQuery={totalsQuery}
          category={category}
          marketplace={scope.marketplace}
          currency={currency}
          families={scope.families}
          onSelectFamily={(family) => {
            changeScope({ ...scope, currency, families: [family] });
            revealSection(listRef.current);
          }}
        />
      ) : null}
      <FinancialReviewMonthTable
        category={category}
        currency={currency}
        rows={rows}
        selectedMonth={selectedMonth}
        onSelect={selectMonth}
        isBusy={loading || comparisonQuery.isFetching}
        onClearFamilies={
          canClearFamilies
            ? () => {
                changeScope({ ...scope, families: [] });
                revealSection(listRef.current);
              }
            : undefined
        }
        emptyMessage={emptyMessage}
      />
      <FinancialReviewMonthDetail
        category={category}
        marketplace={scope.marketplace}
        currency={currency}
        families={scope.families}
        onRetry={onRetry}
        identity={identity}
        month={selectedMonth}
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
