import { useQuery } from "@tanstack/react-query";
import {
  fetchFinancialReviewBounds,
  fetchFinancialReviewPeriod,
  fetchFinancialReviewPeriodTypes,
} from "./api";
import type { Identity } from "./auth-session";
import type { ReviewCategory } from "./financial-review-categories";
import { buildFinancialReviewTimeline, type ReviewScope } from "./financial-review-view";
import { usePayoutPolicy } from "./use-payout-policy";
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
import { buildFeeFamilyOptions } from "./fee-family-catalog";

/** Resolve a marketplace period and keep each monetary unit separate. */
export function useFinancialReviewPeriod(
  identity: Identity,
  category: ReviewCategory,
  scope: ReviewScope,
) {
  const policy = usePayoutPolicy(identity);
  const matureCutoff = policy.data?.mature_cutoff_date ?? "";
  const latestMonth = policy.data?.latest_month ?? "";
  const bounds = useQuery({
    queryKey: [
      "financial-review",
      "bounds",
      identity.session.user.id,
      category,
      scope.marketplace,
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewBounds(
        identity.session.access_token,
        category,
        scope.marketplace,
        signal,
      ),
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

  const totalsQuery = useQuery({
    queryKey: [
      "financial-review",
      "period",
      identity.session.user.id,
      category,
      scope.marketplace,
      year,
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewPeriod(
        identity.session.access_token,
        category,
        year,
        scope.marketplace,
        signal,
      ),
    enabled: matureCutoff !== "" && year !== "",
    staleTime: Infinity,
  });
  const periodRows = totalsQuery.data ?? [];
  const currencies = [...new Set([scope.currency, ...periodRows.map((row) => row.currency ?? "")])]
    .filter(Boolean)
    .sort();
  const currency = scope.currency || (currencies.includes("USD") ? "USD" : currencies[0]) || "";
  const familyQuery = useQuery({
    queryKey: [
      "financial-review",
      "period-families",
      identity.session.user.id,
      category,
      scope.marketplace,
      year,
      currency,
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewPeriodTypes(
        identity.session.access_token,
        category,
        year,
        currency,
        scope.marketplace,
        signal,
      ),
    enabled: matureCutoff !== "" && year !== "" && currency !== "",
    staleTime: Infinity,
  });
  const comparisonQuery = scope.families.length ? familyQuery : totalsQuery;
  const familyTypes = familyQuery.data ?? [];
  const familyOptions = buildFeeFamilyOptions(familyTypes, scope.families);
  const rows = currency
    ? buildFinancialReviewTimeline(
        scope.families.length
          ? buildFinancialReviewFamilyMonths(familyTypes, scope.families)
          : periodRows,
        currency,
      )
    : [];
  const months = rows.map((row) => row.month?.slice(0, 7) ?? "");
  const loading =
    policy.isPending ||
    (matureCutoff !== "" && bounds.isPending) ||
    (year !== "" && totalsQuery.isPending) ||
    (currency !== "" && scope.families.length > 0 && familyQuery.isPending);

  return {
    policy,
    bounds,
    comparisonQuery,
    totalsQuery,
    familyQuery,
    familyOptions,
    matureCutoff,
    latestMonth,
    year,
    years,
    currencies,
    currency,
    rows,
    months,
    loading,
  };
}
