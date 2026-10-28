import { Group, Paper, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewTotals } from "./api";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { FinancialReviewMonthTotals } from "./FinancialReviewMonthTotals";
import { FinancialReviewCoverageNote } from "./FinancialReviewCoverageNote";
import { FinancialReviewSourceDetails } from "./FinancialReviewSourceDetails";
import { FinancialReviewSnapshots } from "./FinancialReviewSnapshots";
import { AmountPrecisionNote } from "./AmountPrecisionNote";
import { buildFinancialReviewFamilyMonths } from "./financial-review-families";
import { reviewCategoryLabel } from "./financial-review-categories";
import type { FinancialReviewMonthScope } from "./financial-review-source-state";
import { monthlyFamilyTypesQueryOptions } from "./financial-review-queries";

interface FinancialReviewMonthContentProps extends FinancialReviewMonthScope {
  onRetry: () => Promise<void>;
}

export function FinancialReviewMonthContent({
  identity,
  category,
  currency,
  families,
  month,
  matureCutoff,
  onRetry,
}: FinancialReviewMonthContentProps) {
  const query = useQuery(
    families.length
      ? {
          ...monthlyFamilyTypesQueryOptions({ identity, category, month, matureCutoff, currency }),
          select: (rows) => buildFinancialReviewFamilyMonths(rows, families),
        }
      : {
          queryKey: [
            "financial-review",
            "totals",
            identity.session.user.id,
            category,
            month,
            currency,
            matureCutoff,
          ],
          queryFn: ({ signal }) =>
            fetchFinancialReviewTotals(
              identity.session.access_token,
              category,
              month,
              currency,
              signal,
            ),
          staleTime: Infinity,
        },
  );
  const rows = query.data ?? [];
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
              ? "Selected fee family totals"
              : `${reviewCategoryLabel(category)} category totals`}
          </Title>
          <Text size="xs" c="dimmed">
            {currency} · Same currency as the overview
          </Text>
        </Group>
        <DetailData
          query={query}
          label="account totals"
          rowCount={rows.length}
          emptyMessage={`No source data for ${currency} in this month.`}
        >
          {rows.length ? <FinancialReviewMonthTotals rows={rows} category={category} /> : null}
        </DetailData>
        <FinancialReviewCoverageNote rows={rows} />
        <Text className="monthly-review-total-formula" size="sm">
          Difference = Finances {category === "DATA_KIOSK" ? "costs" : "amount"} − Data Kiosk{" "}
          {category === "DATA_KIOSK" ? "costs" : "amount"}. A source with no rows contributes zero
          to this comparison.
        </Text>
        <AmountPrecisionNote />
      </Paper>
      <Text className="monthly-review-context" size="sm" c="dimmed">
        {families.length
          ? "This is a diagnostic comparison of the selected fee families. Saved payout reconciliation continues to use the complete Data Kiosk category. "
          : category === "DATA_KIOSK"
            ? "This category's difference is the account reconciliation amount. "
            : "This source comparison is diagnostic; it does not create an additional reconciliation adjustment. "}
        Differences can reflect missing data, timing or scope. Data Kiosk may not cover every source
        type.
      </Text>
      {rows.length ? (
        <FinancialReviewSourceDetails
          identity={identity}
          category={category}
          currency={currency}
          families={families}
          month={month}
          matureCutoff={matureCutoff}
          total={rows[0]}
        />
      ) : null}
      <DetailSection
        stateKey={`financial-review:snapshots:${category}:${month}:${currency}`}
        title="Saved report snapshots"
        collapsible
        description={`Saved company reports for this month in ${currency}. Each retains all categories, all fee families and its original company scope; the fee family filter applies to current source comparisons.`}
      >
        <FinancialReviewSnapshots
          identity={identity}
          month={month}
          currency={currency}
          onRetry={onRetry}
        />
      </DetailSection>
    </>
  );
}
