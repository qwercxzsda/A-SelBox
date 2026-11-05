import { queryOptions } from "@tanstack/react-query";
import { fetchFinancialReviewFamilyTypes } from "./api";
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
