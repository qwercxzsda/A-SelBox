import { useQuery } from "@tanstack/react-query";
import { Button } from "@mantine/core";
import { fetchTransactionTypeTotals, type DatasetFilters } from "./api";
import { selectedPeriod, type DateRange, type PeriodDefinition } from "./summary-periods";
import { CurrentTotals } from "./CurrentTotals";
import { TypeBreakdown } from "./TypeBreakdown";
import type { Identity } from "./auth-session";
import { getErrorMessage } from "./view-model";
import { useTransactionSummaries } from "./use-transaction-summaries";
import { SummaryRecords } from "./SummaryRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import {
  decodeSummaryBreakdown,
  summaryBreakdownKey,
  type SummaryBreakdownSelection,
} from "./detail-view-state";
import { resolveTransactionSearch } from "./transaction-search";
import { transactionSummaryFilters } from "./transaction-summary-filters";
import type { TypeGroupId } from "./transaction-type-families";
import { TransactionTrends } from "./TransactionTrends";
import { useTransactionTrends } from "./use-transaction-trends";
import {
  decodeTransactionSummaryView,
  TRANSACTION_SUMMARY_VIEWS,
  TRANSACTION_TREND_LABELS,
  type TransactionSummaryView,
} from "./transaction-trend-periods";

export function TransactionSummaries({
  identity,
  onRetry,
  filters,
  search,
  onPeriodSelect,
  onShowFilters,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  filters: DatasetFilters;
  search: string;
  onPeriodSelect: (range: DateRange) => void;
  onShowFilters: () => void;
}) {
  const { session, account } = identity;
  const [view, setView] = useWorkspacePreference<TransactionSummaryView>(
    "transaction-summary-view",
    () => "totals",
    decodeTransactionSummaryView,
  );
  // Every view shares the totals' filter-aware marketplace order, including after reload.
  const { scope, latestDate, latestPending, latestError, ...summaries } = useTransactionSummaries(
    identity,
    filters,
    search,
  );
  const trends = useTransactionTrends(
    identity,
    scope,
    summaries.dateRange,
    latestDate,
    view === "totals" ? null : view,
  );
  const needsAnchor = !summaries.dateRange.from && !summaries.dateRange.to;
  const controls = (
    <div className="transaction-summary-views" role="group" aria-label="Transaction summary view">
      {TRANSACTION_SUMMARY_VIEWS.map(({ value, label }) => (
        <Button
          key={value}
          size="compact-sm"
          variant={view === value ? "filled" : "default"}
          aria-pressed={view === value}
          onClick={() => {
            setView(value);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
  const companyNames = new Map(identity.companies.map((company) => [company.id, company.name]));
  const appliedFilters = transactionSummaryFilters(scope, companyNames, account.access_role);
  const [breakdown, setBreakdown] = useWorkspacePreference<SummaryBreakdownSelection | null>(
    "summary-breakdown",
    () => null,
    decodeSummaryBreakdown,
  );
  const stateKey = summaryBreakdownKey(breakdown);
  function openBreakdown(
    period: PeriodDefinition,
    title: string,
    currency: string,
    marketplace: string,
    focusedGroup?: TypeGroupId,
  ) {
    setBreakdown({
      period,
      title,
      currency,
      scope: { ...scope, marketplaces: [marketplace] },
      focusedGroup,
    });
  }
  const searchValues = resolveTransactionSearch(
    "live",
    account.access_role,
    identity.skuOptions,
    breakdown?.scope.search ?? "",
  );
  const breakdownQuery = useQuery({
    queryKey: [
      "company-type-totals",
      session.user.id,
      account.access_role,
      account.company_id,
      breakdown?.scope,
      searchValues,
      breakdown?.period.range.from,
      breakdown?.period.range.to,
      breakdown?.currency,
    ],
    enabled: breakdown !== null,
    queryFn: ({ signal }) => {
      if (breakdown === null) throw new Error("Select a period to view its breakdown.");
      return fetchTransactionTypeTotals({
        accessToken: session.access_token,
        dateFrom: breakdown.period.range.from,
        dateTo: breakdown.period.range.to,
        currency: breakdown.currency,
        ...breakdown.scope,
        searchValues,
        signal,
      });
    },
  });
  return (
    <>
      {view === "totals" ? (
        <CurrentTotals
          {...summaries}
          controls={controls}
          appliedFilters={appliedFilters}
          onDatesChange={onPeriodSelect}
          onOpenBreakdown={openBreakdown}
          onRetry={onRetry}
        />
      ) : (
        <TransactionTrends
          {...trends}
          granularity={view}
          marketplaceOrder={summaries.groups.map((group) => group.marketplace)}
          dateRange={summaries.dateRange}
          pending={trends.pending || (needsAnchor && latestPending)}
          loading={trends.loading || summaries.loading}
          error={(needsAnchor ? latestError : null) ?? trends.error}
          controls={controls}
          appliedFilters={appliedFilters}
          onDatesChange={onPeriodSelect}
          onRetry={onRetry}
          onOpenBreakdown={(range, marketplace, currency, focusedGroup) => {
            const period = selectedPeriod(range);
            if (period)
              openBreakdown(
                period,
                TRANSACTION_TREND_LABELS[view],
                currency,
                marketplace,
                focusedGroup,
              );
          }}
          onShowFilters={onShowFilters}
        />
      )}
      <TypeBreakdown
        stateKey={stateKey}
        focusedGroup={breakdown?.focusedGroup}
        opened={breakdown !== null}
        onClose={() => {
          setBreakdown(null);
        }}
        title={breakdown?.title ?? ""}
        appliedFilters={
          breakdown
            ? transactionSummaryFilters(breakdown.scope, companyNames, account.access_role)
            : []
        }
        periodLabel={breakdown?.period.label ?? ""}
        currency={breakdown?.currency ?? ""}
        totals={breakdownQuery.data}
        loading={breakdownQuery.isFetching}
        error={breakdownQuery.error ? getErrorMessage(breakdownQuery.error) : null}
        onRetry={() => {
          void breakdownQuery.refetch();
        }}
        renderRecords={(selection) =>
          breakdown ? (
            <SummaryRecords
              key={`${stateKey}:${String(selection.revision ?? 0)}:${JSON.stringify(selection.types)}`}
              stateKey={`${stateKey}:selection:${String(selection.revision ?? 0)}`}
              identity={identity}
              range={breakdown.period.range}
              scope={breakdown.scope}
              currency={breakdown.currency}
              types={selection.types}
            />
          ) : null
        }
      />
    </>
  );
}
