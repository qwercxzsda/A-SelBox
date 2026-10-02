import { useQuery } from "@tanstack/react-query";
import { fetchTransactionTypeTotals } from "./api";
import type { DateRange } from "./estimated-periods";
import { EstimatedSummaries } from "./EstimatedSummaries";
import { TypeBreakdown } from "./TypeBreakdown";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage } from "./view-model";
import { useTransactionSummaries, type TransactionSummaryScope } from "./use-transaction-summaries";
import type { SummaryFilter } from "./SummaryFilters";
import { EstimateRecords } from "./EstimateRecords";
import { useWorkspacePreference } from "./use-workspace-preference";
import {
  decodeSummaryBreakdown,
  summaryBreakdownKey,
  type SummaryBreakdownSelection,
} from "./detail-view-state";

function scopeLabels(
  scope: TransactionSummaryScope,
  companies: Map<string, string>,
): SummaryFilter[] {
  return (
    [
      { label: "Company", values: scope.companyIds.map((id) => companyLabel(id, companies)) },
      { label: "SKU", values: scope.skus },
      { label: "Marketplace", values: scope.marketplaces },
    ] satisfies SummaryFilter[]
  ).filter((filter) => filter.values.length > 0);
}

export function TransactionSummaries({
  identity,
  onRetry,
  dateRange,
  companyIds,
  skus,
  marketplaces,
  onPeriodSelect,
  selectedCurrency,
  onCurrencyChange,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  dateRange: DateRange;
  companyIds: string[];
  skus: string[];
  marketplaces: string[];
  onPeriodSelect: (range: DateRange) => void;
  selectedCurrency: string | null;
  onCurrencyChange: (currency: string) => void;
}) {
  const { session, account } = identity;
  const { scope, ...summaries } = useTransactionSummaries(identity, dateRange, {
    companyIds,
    skus,
    marketplaces,
  });
  const companyNames = new Map(identity.companies.map((company) => [company.id, company.name]));
  const appliedFilters = scopeLabels(scope, companyNames);
  const [breakdown, setBreakdown] = useWorkspacePreference<SummaryBreakdownSelection | null>(
    "estimate-breakdown",
    () => null,
    decodeSummaryBreakdown,
  );
  const stateKey = summaryBreakdownKey(breakdown);
  const breakdownQuery = useQuery({
    queryKey: [
      "transaction-type-totals",
      session.user.id,
      account.access_role,
      account.company_id,
      breakdown?.scope,
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
        signal,
      });
    },
  });
  return (
    <>
      <EstimatedSummaries
        {...summaries}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={onCurrencyChange}
        appliedFilters={appliedFilters}
        onPeriodSelect={onPeriodSelect}
        onOpenBreakdown={(period, title, currency) => {
          setBreakdown({
            period: { label: period.label, range: period.range },
            title,
            currency,
            scope,
          });
        }}
        onRetry={onRetry}
        coverageNote={
          account.access_role === "operator"
            ? "Company, SKU, and Marketplace filters apply to all three totals. DATE applies only to Selected dates. Select a day or month to filter Transactions."
            : "SKU and Marketplace filters apply to all three totals. DATE applies only to Selected dates. Select a day or month to filter Transactions."
        }
      />
      <TypeBreakdown
        stateKey={stateKey}
        opened={breakdown !== null}
        onClose={() => {
          setBreakdown(null);
        }}
        title={breakdown?.title ?? ""}
        appliedFilters={breakdown ? scopeLabels(breakdown.scope, companyNames) : []}
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
            <EstimateRecords
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
