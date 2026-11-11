import { Button, Group, Paper, Text } from "@mantine/core";
import { useRef, useState } from "react";
import type { CanonicalRow } from "./api";
import { projectFinancialReviewChart } from "./financial-review-chart";
import { FinancialReviewChartPlot } from "./FinancialReviewChartPlot";
import { FinancialReviewChartLegend } from "./FinancialReviewChartLegend";
import { FinancialReviewChartValues } from "./FinancialReviewChartValues";
import { buildFinancialReviewFamilySeries } from "./financial-review-family-series";
import { HelpPopover } from "./HelpPopover";
export function FinancialReviewTrend({
  rows,
  currency,
  familyTypes,
  families,
  familyLoading,
  familyError,
  onRetryFamilies,
  onSelect,
}: {
  rows: CanonicalRow[];
  currency: string;
  familyTypes: CanonicalRow[] | null;
  families: readonly string[];
  familyLoading: boolean;
  familyError: boolean;
  onRetryFamilies: () => void;
  onSelect: (month: string) => void;
}) {
  const figure = useRef<HTMLElement>(null);
  const [inspectedMonth, setInspectedMonth] = useState<string | null>(null);
  const series = familyTypes ? buildFinancialReviewFamilySeries(familyTypes, rows, families) : [];
  const familyChart = series.length ? projectFinancialReviewChart(rows, series) : null;
  const chart = familyChart ?? projectFinancialReviewChart(rows);
  if (!chart)
    return (
      <Text size="sm" c="dimmed" mb="md">
        Chart unavailable for this range. Monthly amounts are shown below.
      </Text>
    );
  const points = chart.months.filter((point) => point !== null);
  const latest = points[points.length - 1];
  const inspected = points.find((point) => point.month === inspectedMonth) ?? latest;

  return (
    <Paper
      ref={figure}
      tabIndex={-1}
      component="figure"
      withBorder
      p="md"
      className="financial-review-trend"
      aria-label="Monthly and running differences"
    >
      <Group justify="space-between" gap="sm" mb="sm">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Difference across months
          </Text>
          <HelpPopover label="Difference chart help">
            <p>
              Bars show monthly Finances − Data Kiosk. Lines accumulate available months from
              January; months without source records remain gaps.
            </p>
            <p>
              {familyChart
                ? "Family lines are lighter than the total, and positive and negative bars stack separately. "
                : ""}
              Hover or focus a month to inspect its values, or choose a month below. Open month
              details to see the source records.
            </p>
          </HelpPopover>
        </Group>
        <Group gap="md" className="financial-review-trend-legend">
          <span>
            <i className="financial-review-monthly-key" />
            {familyChart ? "Monthly differences by family" : "Monthly difference"}
          </span>
          <span>
            <i className="financial-review-running-key" />
            Total running difference
          </span>
        </Group>
      </Group>
      {!familyChart ? (
        <Group justify="space-between" gap="xs" mb="sm">
          <Text size="sm" c="dimmed" role="status">
            {familyLoading
              ? "Fee-family details are loading. Showing total differences."
              : familyError
                ? "Fee-family details are unavailable. Showing total differences."
                : "Fee-family details do not match the current totals. Showing total differences."}
          </Text>
          {!familyLoading ? (
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                figure.current?.focus({ preventScroll: true });
                onRetryFamilies();
              }}
            >
              Retry family chart
            </Button>
          ) : null}
        </Group>
      ) : null}
      <FinancialReviewChartPlot
        chart={chart}
        currency={currency}
        inspected={inspected}
        onInspect={setInspectedMonth}
        onSelect={onSelect}
      />
      {familyChart ? (
        <FinancialReviewChartLegend families={chart.families} latest={latest} />
      ) : null}
      <FinancialReviewChartValues
        point={inspected}
        points={points}
        families={chart.families}
        currency={currency}
        onInspect={setInspectedMonth}
        onSelect={onSelect}
      />
    </Paper>
  );
}
