import { useId, useState } from "react";
import { Group, Paper, Title } from "@mantine/core";
import { REVIEW_REASONS, type ReviewReason } from "./api/financial-review";
import { REVIEW_REASON_LABELS } from "./categories";
import { projectDifferenceChart } from "./financial-review-chart";
import type { ReviewYear } from "./financial-review-model";
import { reviewMonthCount } from "./financial-review-view";
import { EmptyState } from "./EmptyState";
import { FinancialReviewChartLegend } from "./FinancialReviewChartLegend";
import { FinancialReviewChartPlot } from "./FinancialReviewChartPlot";
import { HelpPopover } from "./HelpPopover";

const REASON_HELP: Record<ReviewReason, string> = {
  NO_ASSIGNMENT: "No company is assigned to the SKU or ID.",
  REFERENCE_NOT_FOUND: "The charge's report or record is not loaded.",
  ROUNDING: "Report rows round differently from Amazon's charge.",
  TOTALS_DIFFER: "The report total differs from the charge.",
  CHARGED_IN_ANOTHER_MONTH:
    "Amazon charged it in another month or marketplace; each period shows a balancing entry.",
  SPLIT_OWNERSHIP: "The ledger's products belong to different companies.",
  LEDGER_MONTH_NOT_LOADED: "The inventory ledger for the charge's months is not loaded.",
  NOT_IN_LEDGER: "The FNSKU or ASIN is not in the ledger for the charge's months.",
  NO_ID_ON_CHARGE: "The charge has no ID to look up.",
};

function ChartHelp() {
  return (
    <HelpPopover label="Differences by month help">
      <p>
        Bars: each month&apos;s differences by reason. Line: running total since January. Select a
        month or bar for its records.
      </p>
      <ul className="financial-review-reason-help">
        {REVIEW_REASONS.map((reason) => (
          <li key={reason}>
            <strong>{REVIEW_REASON_LABELS[reason]}:</strong> {REASON_HELP[reason]}
          </li>
        ))}
      </ul>
    </HelpPopover>
  );
}

/**
 * The year's differences by month. Loading, failed and empty years keep the plot frame, the
 * key line and the legend's reserved rows, so the card height does not change with the scope.
 */
export function FinancialReviewChart({
  review,
  isPlaceholderData,
  isBusy,
  onSelect,
}: {
  /** Null while the first result loads or after a failed check. */
  review: ReviewYear | null;
  isPlaceholderData: boolean;
  isBusy: boolean;
  onSelect: (month: string, reason: ReviewReason | null) => void;
}) {
  const titleId = useId();
  const [inspected, setInspected] = useState<string | null>(null);
  const chart = review ? projectDifferenceChart(review, reviewMonthCount(review.year)) : null;
  const months = chart?.points.filter((point) => point !== null) ?? [];
  // The roving keyboard target; it is shaded only while hovered or focused.
  const inspectedMonth =
    months.find((point) => point.month === inspected)?.month ?? months.at(-1)?.month ?? "";
  return (
    <Paper
      component="section"
      withBorder
      p="md"
      className="financial-review-chart"
      aria-labelledby={titleId}
      aria-busy={isBusy}
      data-placeholder={isPlaceholderData || undefined}
    >
      <Group justify="space-between" gap="sm">
        <Group gap={6} wrap="nowrap">
          <Title order={3} size="h4" className="detail-section-title" id={titleId}>
            Differences by month
          </Title>
          <ChartHelp />
        </Group>
        <Group
          gap="md"
          className="financial-review-chart-keys"
          data-hidden={!chart || undefined}
          aria-hidden="true"
        >
          <span>
            <i className="financial-review-bar-key" />
            Monthly difference by reason
          </span>
          <span>
            <i className="financial-review-running-key" />
            Running difference
          </span>
        </Group>
      </Group>
      <div className="financial-review-chart-body">
        {chart && review ? (
          <FinancialReviewChartPlot
            chart={chart}
            currency={review.currency}
            inspectedMonth={inspectedMonth}
            onInspect={setInspected}
            onSelect={(month, reason) => {
              if (!isPlaceholderData) onSelect(month, reason);
            }}
          />
        ) : (
          <div className="amount-trend-plot financial-review-chart-empty">
            {review ? <EmptyState title={`No differences in ${String(review.year)}`} /> : null}
          </div>
        )}
        <FinancialReviewChartLegend
          reasons={chart && review ? review.reasons : []}
          currency={review?.currency ?? ""}
        />
      </div>
    </Paper>
  );
}
