import { Group, Paper, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewTotals } from "./api";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { FinancialReviewSourceDetails } from "./FinancialReviewSourceDetails";
import { FinancialReviewSnapshots } from "./FinancialReviewSnapshots";
import { AmountPrecisionNote } from "./AmountPrecisionNote";
import {
  reviewAmountColumns,
  reviewCategoryLabel,
  type ReviewCategory,
} from "./financial-review-categories";

interface FinancialReviewMonthContentProps {
  identity: Identity;
  category: ReviewCategory;
  currency: string;
  month: string;
  matureCutoff: string;
  onRetry: () => Promise<void>;
}

export function FinancialReviewMonthContent({
  identity,
  category,
  currency,
  month,
  matureCutoff,
  onRetry,
}: FinancialReviewMonthContentProps) {
  const query = useQuery({
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
      fetchFinancialReviewTotals(identity.session.access_token, category, month, currency, signal),
    staleTime: Infinity,
  });
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
            {reviewCategoryLabel(category)} category totals
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
          {rows.length ? (
            <DetailTable
              label="Financial review totals"
              columns={reviewAmountColumns(category).filter((column) => column.key !== "currency")}
              rows={rows}
              rowKey={(row) => row.currency ?? ""}
              minWidth={520}
            />
          ) : null}
        </DetailData>
        <Text className="monthly-review-total-formula" size="sm">
          Difference = Finances {category === "DATA_KIOSK" ? "costs" : "amount"} − Data Kiosk{" "}
          {category === "DATA_KIOSK" ? "costs" : "amount"}. A source with no rows contributes zero
          to this comparison.
        </Text>
        <AmountPrecisionNote />
      </Paper>
      <Text className="monthly-review-context" size="sm" c="dimmed">
        {category === "DATA_KIOSK"
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
          month={month}
          matureCutoff={matureCutoff}
          total={rows[0]}
        />
      ) : null}
      <DetailSection
        stateKey={`financial-review:snapshots:${category}:${month}:${currency}`}
        title="Saved report snapshots"
        collapsible
        description={`Saved company reports for this month in ${currency}. Each retains all categories and its original company scope.`}
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
