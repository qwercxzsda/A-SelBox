import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { FinancialReviewFamilyTables } from "./FinancialReviewFamilyTables";
import { buildFinancialReviewFamilies } from "./financial-review-families";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";
import {
  monthlyFamilyTypesQueryOptions,
  monthlySourceTotalsQueryOptions,
} from "./financial-review-queries";
import { applyComparisonCoverage, sameSourceRevision } from "./source-diagnostics";
import { useSourceRevisionGuard, diagnosticQueryState } from "./source-diagnostics-context";
import type { SourceTotals } from "./api/source-totals";
import type { SourceTypeTotals } from "./api/financial-review-type-reader";

export function FinancialReviewFamilyBreakdown({
  query,
  category,
  currency,
  marketplace,
  families,
  onSelectFamily,
  sourceTotals,
  sourceQuery,
}: {
  query: UseQueryResult<SourceTypeTotals>;
  sourceQuery: UseQueryResult<SourceTotals>;
  sourceTotals: SourceTotals | undefined;
  category: string;
  currency: string;
  marketplace: string;
  families: readonly string[];
  onSelectFamily: (family: string) => void;
}) {
  const consistent = useSourceRevisionGuard(query.data);
  const compatible =
    consistent && sourceTotals !== undefined && sameSourceRevision(sourceTotals, query.data);
  const rows = compatible
    ? applyComparisonCoverage(
        buildFinancialReviewFamilies(query.data?.rows ?? [], families),
        sourceTotals,
      )
    : [];
  return (
    <DetailSection
      title="Type family breakdown"
      headingOrder={3}
      stateKey={`financial-review:family-breakdown:${category}`}
      collapsible
    >
      <DetailData
        query={diagnosticQueryState([query, sourceQuery], compatible)}
        label="type family breakdown"
        rowCount={rows.length}
        emptyMessage={`No source types match these type families for ${marketplace} in this year and currency.`}
      >
        <FinancialReviewFamilyTables
          rows={rows}
          currency={currency}
          period="Yearly"
          onSelectFamily={onSelectFamily}
        />
      </DetailData>
    </DetailSection>
  );
}

export function FinancialReviewFamilies(scope: FinancialReviewMonthScope) {
  const { families, currency } = scope;
  const query = useQuery(monthlyFamilyTypesQueryOptions(scope));
  const sourceQuery = useQuery(monthlySourceTotalsQueryOptions(scope));
  const consistent = useSourceRevisionGuard(query.data);
  const sourceConsistent = useSourceRevisionGuard(sourceQuery.data);
  const source = sourceQuery.data;
  const compatible =
    consistent &&
    sourceConsistent &&
    source !== undefined &&
    sameSourceRevision(source, query.data);
  const rows = compatible
    ? applyComparisonCoverage(
        buildFinancialReviewFamilies(query.data?.rows ?? [], families),
        source,
      )
    : [];
  return (
    <DetailData
      query={diagnosticQueryState([query, sourceQuery], compatible)}
      label="type family comparison"
      rowCount={rows.length}
      emptyMessage="No source types match these type families."
    >
      <FinancialReviewFamilyTables rows={rows} currency={currency} period="Monthly" />
    </DetailData>
  );
}
