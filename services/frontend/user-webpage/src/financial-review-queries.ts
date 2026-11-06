import { queryOptions } from "@tanstack/react-query";
import { fetchFinancialReviewFamilyTypes, fetchFinancialReviewTotals } from "./api";
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
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

/** Selected-family totals reuse the complete raw-type cache with an observer-local projection. */
export function monthlyReviewTotalsQueryOptions(scope: FinancialReviewMonthScope) {
  if (scope.families.length) {
    return queryOptions({
      ...monthlyFamilyTypesQueryOptions(scope),
      select: (rows) => buildFinancialReviewFamilyMonths(rows, scope.families),
    });
  }
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
      fetchFinancialReviewTotals(
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
