import { Group, Paper, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialReviewTotals } from "./api";
import type { Identity } from "./auth-session";
import { DetailData } from "./DetailData";
import { DetailSection } from "./DetailSection";
import { DetailTable } from "./DetailTable";
import { FinancialReviewSourceDetails } from "./FinancialReviewSourceDetails";
import { FinancialReviewSnapshots } from "./FinancialReviewSnapshots";
import {
  reviewAmountColumns,
  reviewCategoryLabel,
  type ReviewCategory,
} from "./financial-review-categories";

interface FinancialReviewMonthContentProps {
  identity: Identity;
  category: ReviewCategory;
  month: string;
  matureCutoff: string;
  onRetry: () => Promise<void>;
}

export function FinancialReviewMonthContent({
  identity,
  category,
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
      matureCutoff,
    ],
    queryFn: ({ signal }) =>
      fetchFinancialReviewTotals(identity.session.access_token, category, month, signal),
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
            {rows.length} {rows.length === 1 ? "currency" : "currencies"} · Shown separately
          </Text>
        </Group>
        <DetailData
          query={query}
          label="account totals"
          rowCount={rows.length}
          emptyMessage="No source data for this month."
        >
          {rows.length ? (
            <DetailTable
              label="Financial review by currency"
              columns={reviewAmountColumns(category)}
              rows={rows}
              rowKey={(row) => row.currency ?? ""}
              minWidth={650}
            />
          ) : null}
        </DetailData>
        <Text className="monthly-review-total-formula" size="sm">
          Difference = Settlement {category === "DATA_KIOSK" ? "costs" : "amount"} − Data Kiosk{" "}
          {category === "DATA_KIOSK" ? "costs" : "amount"}. A source with no rows contributes zero
          to this comparison.
        </Text>
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
          month={month}
          matureCutoff={matureCutoff}
          totals={rows}
        />
      ) : null}
      <DetailSection
        stateKey={`financial-review:snapshots:${category}:${month}`}
        title="Saved report snapshots"
        collapsible
        description="Report versions saved for this month. Each retains its company scope and all categories; current category and currency selections do not filter these historical snapshots."
      >
        <FinancialReviewSnapshots identity={identity} month={month} onRetry={onRetry} />
      </DetailSection>
    </>
  );
}
