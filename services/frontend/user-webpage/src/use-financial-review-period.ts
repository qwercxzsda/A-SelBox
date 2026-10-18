import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewBounds, fetchFinancialReviewPeriod } from "./api";
import type { Identity } from "./auth-session";
import type { ReviewCategory } from "./financial-review-categories";
import { buildFinancialReviewTimeline, type ReviewScope } from "./financial-review-view";
import { usePayoutPolicy } from "./use-payout-policy";

/** Resolve the available year and currencies without changing the saved scope. */
export function useFinancialReviewPeriod(
  identity: Identity,
  category: ReviewCategory,
  scope: ReviewScope,
) {
  const policy = usePayoutPolicy(identity);
  const matureCutoff = policy.data?.mature_cutoff_date ?? "";
  const latestMonth = policy.data?.latest_month ?? "";
  const bounds = useQuery({
    queryKey: ["financial-review", "bounds", identity.session.user.id, category, matureCutoff],
    queryFn: ({ signal }) =>
      fetchFinancialReviewBounds(identity.session.access_token, category, signal),
    enabled: matureCutoff !== "",
    staleTime: Infinity,
  });
  const year = scope.year || (bounds.data?.lastMonth?.slice(0, 4) ?? "");
  const firstYear = Number(bounds.data?.firstMonth?.slice(0, 4));
  const lastYear = Number(bounds.data?.lastMonth?.slice(0, 4));
  const years =
    firstYear && lastYear
      ? Array.from({ length: lastYear - firstYear + 1 }, (_, index) =>
          String(lastYear - index).padStart(4, "0"),
        )
      : [];
  if (year && !years.includes(year)) years.push(year);
  years.sort((left, right) => right.localeCompare(left));

  const query = useQuery({
    queryKey: [
      "financial-review",
      "period",
      identity.session.user.id,
      category,
      year,
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewPeriod(identity.session.access_token, category, year, signal),
    enabled: matureCutoff !== "" && year !== "",
    staleTime: Infinity,
  });
  const periodRows = query.data ?? [];
  const currencies = [...new Set([scope.currency, ...periodRows.map((row) => row.currency ?? "")])]
    .filter(Boolean)
    .sort();
  const rows = buildFinancialReviewTimeline(periodRows, scope.currency);
  const months = rows.map((row) => row.month?.slice(0, 7) ?? "");
  const loading =
    policy.isPending ||
    (matureCutoff !== "" && bounds.isPending) ||
    (year !== "" && query.isPending);

  return {
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
  };
}
