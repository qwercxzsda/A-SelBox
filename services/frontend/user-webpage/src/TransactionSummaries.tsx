import type { SummaryPeriod } from "./summary-types";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTransactionTypeTotals } from "./api";
import type { DateRange } from "./estimated-periods";
import { EstimatedSummaries } from "./EstimatedSummaries";
import { TypeBreakdown } from "./TypeBreakdown";
import type { Identity } from "./auth-session";
import { companyLabel, getErrorMessage } from "./view-model";
import { useTransactionSummaries, type TransactionSummaryScope } from "./use-transaction-summaries";
import type { SummaryFilter } from "./SummaryFilters";

interface BreakdownSelection {
  period: SummaryPeriod;
  title: string;
  currency: string;
  scope: TransactionSummaryScope;
  appliedFilters: SummaryFilter[];
}

export function TransactionSummaries({
  identity,
  onRetry,
  dateRange,
  companyIds,
  skus,
  marketplaces,
  onPeriodSelect,
}: {
  identity: Identity;
  onRetry: () => Promise<void>;
  dateRange: DateRange;
  companyIds: string[];
  skus: string[];
  marketplaces: string[];
  onPeriodSelect: (range: DateRange) => void;
}) {
  const { session, account } = identity;
  const { scope, ...summaries } = useTransactionSummaries(identity, dateRange, {
    companyIds,
    skus,
    marketplaces,
  });
  const companyNames = new Map(identity.companies.map((company) => [company.id, company.name]));
  const appliedFilters = (
    [
      { label: "Company", values: scope.companyIds.map((id) => companyLabel(id, companyNames)) },
      { label: "SKU", values: scope.skus },
      { label: "Marketplace", values: scope.marketplaces },
    ] satisfies SummaryFilter[]
  ).filter((filter) => filter.values.length > 0);
  const [breakdown, setBreakdown] = useState<BreakdownSelection | null>(null);
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
        appliedFilters={appliedFilters}
        onPeriodSelect={onPeriodSelect}
        onOpenBreakdown={(period, title, currency) => {
          setBreakdown({
            period,
            title,
            currency,
            scope,
            appliedFilters,
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
        opened={breakdown !== null}
        onClose={() => {
          setBreakdown(null);
        }}
        title={breakdown?.title ?? ""}
        appliedFilters={breakdown?.appliedFilters ?? []}
        periodLabel={breakdown?.period.label ?? ""}
        currency={breakdown?.currency ?? ""}
        totals={breakdownQuery.data}
        loading={breakdownQuery.isFetching}
        error={breakdownQuery.error ? getErrorMessage(breakdownQuery.error) : null}
        onRetry={() => {
          void breakdownQuery.refetch();
        }}
      />
    </>
  );
}
