import { useQuery } from "@tanstack/react-query";
import {
  fetchFinancialReviewBounds,
  fetchCurrentSourceTotals,
  fetchFinancialReviewPeriodTypes,
} from "./api";
import type { Identity } from "./auth-session";
import type { ReviewCategory } from "./financial-review-categories";
import {
  buildFinancialReviewTimeline,
  resolveReviewCurrency,
  resolveReviewYear,
  type ReviewScope,
} from "./financial-review-view";
import { usePayoutPolicy } from "./use-payout-policy";
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
import { buildFeeFamilyOptions } from "./fee-family-catalog";
import {
  applyComparisonCoverage,
  buildSourceComparisons,
  monthSourcePeriod,
  sameSourceRevision,
} from "./source-diagnostics";
import { useSourceRevisionGuard } from "./source-diagnostics-context";

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
  const lastAvailableMonth =
    bounds.data?.lastMonth && latestMonth
      ? [bounds.data.lastMonth, latestMonth.slice(0, 7)].sort()[0]
      : null;
  const availableBounds =
    bounds.data &&
    lastAvailableMonth &&
    bounds.data.firstMonth &&
    bounds.data.firstMonth <= lastAvailableMonth
      ? { firstMonth: bounds.data.firstMonth, lastMonth: lastAvailableMonth }
      : undefined;
  const { year, years } = resolveReviewYear(scope.year, availableBounds);
  const lastRequestedMonth =
    year && latestMonth ? [`${year}-12`, latestMonth.slice(0, 7)].sort()[0] : "";
  const periodAvailable = matureCutoff !== "" && year !== "" && lastRequestedMonth >= `${year}-01`;

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
      fetchCurrentSourceTotals(
        identity.session.access_token,
        {
          startDate: `${year}-01-01`,
          endDate: monthSourcePeriod(lastRequestedMonth).endDate,
          category,
          marketplace: scope.marketplace,
          grouping: "month",
        },
        signal,
      ),
    enabled: periodAvailable,
    staleTime: Infinity,
  });
  const consistent = useSourceRevisionGuard(totalsQuery.data);
  const sourceTotals = consistent ? totalsQuery.data : undefined;
  const periodRows = sourceTotals ? buildSourceComparisons(sourceTotals, category) : [];
  const { currency, currencies } = resolveReviewCurrency(scope.currency, periodRows);
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
        lastRequestedMonth,
        signal,
      ),
    enabled: periodAvailable && currency !== "",
    staleTime: Infinity,
  });
  const comparisonQuery = scope.families.length ? familyQuery : totalsQuery;
  const familyConsistent = useSourceRevisionGuard(familyQuery.data);
  const compatibleFamilyTypes =
    familyConsistent && sameSourceRevision(sourceTotals, familyQuery.data)
      ? (familyQuery.data?.rows ?? [])
      : null;
  const familyTypes = compatibleFamilyTypes ?? [];
  const familyOptions = buildFeeFamilyOptions(familyTypes, scope.families);
  const rows = currency
    ? buildFinancialReviewTimeline(
        scope.families.length
          ? sourceTotals
            ? applyComparisonCoverage(
                buildFinancialReviewFamilyMonths(familyTypes, scope.families),
                sourceTotals,
              )
            : []
          : periodRows,
        currency,
      )
    : [];
  const months = rows.map((row) => row.month?.slice(0, 7) ?? "");
  const loading =
    policy.isPending ||
    (matureCutoff !== "" && bounds.isPending) ||
    (periodAvailable && (totalsQuery.isPending || !consistent)) ||
    (currency !== "" && scope.families.length > 0 && (familyQuery.isPending || !familyConsistent));

  return {
    policy,
    bounds,
    comparisonQuery,
    totalsQuery,
    sourceTotals,
    familyQuery,
    familyTypes: compatibleFamilyTypes,
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
