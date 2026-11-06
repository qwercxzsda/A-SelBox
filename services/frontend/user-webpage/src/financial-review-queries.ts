import { queryOptions } from "@tanstack/react-query";
import { fetchFinancialReviewFamilyTypes, fetchCurrentSourceTotals } from "./api";
import { monthSourcePeriod } from "./source-diagnostics";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";

/** Complete raw types are shared; each observer derives its selected-family view. */
export function monthlyFamilyTypesQueryOptions({
  identity,
  category,
  month,
  matureCutoff,
  currency,
  marketplace,
}: Omit<FinancialReviewMonthScope, "families">) {
  return queryOptions({
    queryKey: [
      "financial-review",
      "monthly-family-types",
      identity.session.user.id,
      category,
      month,
      matureCutoff,
      currency,
      marketplace,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewFamilyTypes(
        identity.session.access_token,
        category,
        month,
        currency,
        marketplace,
        signal,
      ),
    staleTime: Infinity,
  });
}

/** One native aggregate response provides both paired values and retrieval coverage. */
export function monthlySourceTotalsQueryOptions(scope: FinancialReviewMonthScope) {
  const { identity, category, month, currency, marketplace, matureCutoff } = scope;
  return queryOptions({
    queryKey: [
      "financial-review",
      "totals",
      identity.session.user.id,
      category,
      month,
      currency,
      marketplace,
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchCurrentSourceTotals(
        identity.session.access_token,
        {
          ...monthSourcePeriod(month),
          category,
          currency,
          marketplace,
          grouping: "month",
        },
        signal,
      ),
    staleTime: Infinity,
  });
}
