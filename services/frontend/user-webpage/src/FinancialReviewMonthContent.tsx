import { reviewPeriodKey } from "./financial-review-scope-key";
import { Group, Paper, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { FinancialReviewMonthTotals } from "./FinancialReviewMonthTotals";
import { FinancialReviewCoverageNote } from "./FinancialReviewCoverageNote";
import { FinancialReviewSourceDetails } from "./FinancialReviewSourceDetails";
import { FinancialReviewSnapshots } from "./FinancialReviewSnapshots";
import { AmountPrecisionNote } from "./AmountPrecisionNote";
import { reviewCategoryLabel } from "./financial-review-categories";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";
import {
  monthlySourceTotalsQueryOptions,
  monthlyFamilyTypesQueryOptions,
} from "./financial-review-queries";
import {
  applyComparisonCoverage,
  buildSourceComparisons,
  sameSourceRevision,
} from "./source-diagnostics";
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
import { useSourceRevisionGuard, diagnosticQueryState } from "./source-diagnostics-context";

interface FinancialReviewMonthContentProps extends FinancialReviewMonthScope {
  onRetry: () => Promise<void>;
}

export function FinancialReviewMonthContent({
  onRetry,
  ...scope
}: FinancialReviewMonthContentProps) {
  const { identity, category, currency, marketplace, families, month } = scope;
  const sourceQuery = useQuery(monthlySourceTotalsQueryOptions(scope));
  const familyQuery = useQuery({
    ...monthlyFamilyTypesQueryOptions(scope),
    enabled: families.length > 0,
  });
  const consistent = useSourceRevisionGuard(sourceQuery.data);
  const familyConsistent = useSourceRevisionGuard(families.length ? familyQuery.data : undefined);
  const source = sourceQuery.data;
  const compatible =
    consistent &&
    familyConsistent &&
    (!families.length || sameSourceRevision(source, familyQuery.data));
  const query = diagnosticQueryState(
    families.length ? [sourceQuery, familyQuery] : [sourceQuery],
    compatible,
  );
  const rows =
    source && compatible
      ? families.length
        ? applyComparisonCoverage(
            buildFinancialReviewFamilyMonths(familyQuery.data?.rows ?? [], families),
            source,
          )
        : buildSourceComparisons(source, category)
      : [];
  return (
    <>
      <Paper
        component="section"
        aria-label="Account totals"
        className="monthly-review-total"
        withBorder
        p="md"
      >
        <Group justify="space-between" gap="xs" mb="sm">
          <Title order={4} className="monthly-review-total-title">
            {families.length
              ? "Selected type family totals"
              : `${reviewCategoryLabel(category)} category totals`}
          </Title>
          <Text size="xs" c="dimmed">
            {marketplace} · {currency}
          </Text>
        </Group>
        <DetailData
          query={query}
          label="account totals"
          rowCount={rows.length}
          emptyMessage={`No source data for ${marketplace} in ${currency} in this month.`}
        >
          {rows.length ? <FinancialReviewMonthTotals rows={rows} category={category} /> : null}
        </DetailData>
        <FinancialReviewCoverageNote rows={rows} />
        <Text className="monthly-review-total-formula" size="sm">
          Difference = Finances {category === "DATA_KIOSK" ? "costs" : "amount"} − Data Kiosk{" "}
          {category === "DATA_KIOSK" ? "costs" : "amount"}. An absent amount is zero only when
          retrieval coverage includes the complete period.
        </Text>
        <AmountPrecisionNote />
      </Paper>
      <Text className="monthly-review-context" size="sm" c="dimmed">
        This comparison is diagnostic and never changes transaction amounts or saved payouts.{" "}
        Differences can reflect missing data, timing or scope. Data Kiosk may not cover every source
        type.
      </Text>
      <FinancialReviewSourceDetails {...scope} total={rows[0]} />
      <DetailSection
        stateKey={`financial-review:snapshots:${category}:${reviewPeriodKey(month, marketplace, currency)}`}
        title="Saved report snapshots"
        collapsible
        description={`Saved company reports for ${marketplace} this month in ${currency}. Each retains all categories, all type families and its original company scope; the type family filter applies to current source comparisons.`}
      >
        <FinancialReviewSnapshots
          identity={identity}
          month={month}
          currency={currency}
          marketplace={marketplace}
          onRetry={onRetry}
        />
      </DetailSection>
    </>
  );
}
