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
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
import { buildTypeFamilyOptions } from "./transaction-type-family-catalog";
import {
  applyComparisonCoverage,
  buildSourceComparisons,
  sameSourceRevision,
} from "./source-diagnostics";
import { useSourceRevisionGuard } from "./source-diagnostics-context";

/** Resolve a marketplace period and keep each monetary unit separate. */
export function useFinancialReviewPeriod(
  identity: Identity,
  category: ReviewCategory,
  scope: ReviewScope,
) {
  const bounds = useQuery({
    queryKey: ["financial-review", "bounds", identity.session.user.id, category, scope.marketplace],
    queryFn: ({ signal }) =>
      fetchFinancialReviewBounds(
        identity.session.access_token,
        category,
        scope.marketplace,
        signal,
      ),
    staleTime: Infinity,
  });
  const { year, years } = resolveReviewYear(scope.year, bounds.data);
  const periodAvailable = year !== "";

  const totalsQuery = useQuery({
    queryKey: [
      "financial-review",
      "period",
      identity.session.user.id,
      category,
      scope.marketplace,
      year,
    ],
    queryFn: ({ signal }) =>
      fetchCurrentSourceTotals(
        identity.session.access_token,
        {
          startDate: `${year}-01-01`,
          endDate: `${year}-12-31`,
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
  const familyOptions = buildTypeFamilyOptions(familyTypes, scope.families);
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
    bounds.isPending ||
    (periodAvailable && (totalsQuery.isPending || !consistent)) ||
    (currency !== "" && scope.families.length > 0 && (familyQuery.isPending || !familyConsistent));

  return {
    bounds,
    comparisonQuery,
    totalsQuery,
    sourceTotals,
    familyQuery,
    familyTypes: compatibleFamilyTypes,
    familyOptions,
    year,
    years,
    currencies,
    currency,
    rows,
    months,
    loading,
  };
}
