import { useQuery } from "@tanstack/react-query";
import { fetchTransactionTypeTotals, type AppAccount, type DatasetFilters } from "./api";
import type { DateRange } from "./summary-periods";
import { CurrentTotals } from "./CurrentTotals";
import { TypeBreakdown } from "./TypeBreakdown";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage } from "./view-model";
import { useTransactionSummaries } from "./use-transaction-summaries";
import type { TransactionSummaryScope } from "./api/types";
import type { SummaryFilter } from "./SummaryFilters";
import { SummaryRecords } from "./SummaryRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import {
  decodeSummaryBreakdown,
  summaryBreakdownKey,
  type SummaryBreakdownSelection,
} from "./detail-view-state";
import { resolveTransactionSearch } from "./transaction-search";
import { humanizeCode } from "./categories";
import { filterOptions, transactionTypeValues } from "./filter-options";
import { transactionTypeSelectionLabels } from "./transaction-type-groups";

function scopeLabels(
  scope: TransactionSummaryScope,
  companies: Map<string, string>,
  role: AppAccount["access_role"],
): SummaryFilter[] {
  return (
    [
      { label: "Company", values: scope.companyIds.map((id) => companyLabel(id, companies)) },
      { label: "SKU", values: scope.skus },
      { label: "Marketplace", values: scope.marketplaces },
      { label: "Source", values: scope.sources.map(humanizeCode) },
      {
        label: "Type",
        values: transactionTypeSelectionLabels(
          filterOptions("component_type", transactionTypeValues("live", role), scope.types),
          scope.types,
        ),
      },
      {
        label: "Fee rate",
        values:
          scope.feeApplicability.length === 1
            ? [scope.feeApplicability[0] === "applicable" ? "Applicable" : "Not applicable"]
            : [],
      },
      { label: "Search", values: scope.search ? [scope.search] : [] },
    ] satisfies SummaryFilter[]
  ).filter((filter) => filter.values.length > 0);
}

export function TransactionSummaries({
  identity,
  onRetry,
  filters,
  search,
  onPeriodSelect,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  filters: DatasetFilters;
  search: string;
  onPeriodSelect: (range: DateRange) => void;
}) {
  const { session, account } = identity;
  const { scope, ...summaries } = useTransactionSummaries(identity, filters, search);
  const companyNames = new Map(identity.companies.map((company) => [company.id, company.name]));
  const appliedFilters = scopeLabels(scope, companyNames, account.access_role);
  const [breakdown, setBreakdown] = useWorkspacePreference<SummaryBreakdownSelection | null>(
    "summary-breakdown",
    () => null,
    decodeSummaryBreakdown,
  );
  const stateKey = summaryBreakdownKey(breakdown);
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
      <CurrentTotals
        {...summaries}
        appliedFilters={appliedFilters}
        onDatesChange={onPeriodSelect}
        onOpenBreakdown={(period, title, currency, marketplace) => {
          setBreakdown({
            period,
            title,
            currency,
            scope: { ...scope, marketplaces: [marketplace] },
          });
        }}
        onRetry={onRetry}
      />
      <TypeBreakdown
        stateKey={stateKey}
        opened={breakdown !== null}
        onClose={() => {
          setBreakdown(null);
        }}
        title={breakdown?.title ?? ""}
        appliedFilters={
          breakdown ? scopeLabels(breakdown.scope, companyNames, account.access_role) : []
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
