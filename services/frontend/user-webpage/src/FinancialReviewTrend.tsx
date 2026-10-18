import { Group, Paper, Text } from "@mantine/core";
import type { CanonicalRow } from "./api";
import { formatRecordMonth } from "./date-display";
import { formatMoney } from "./decimal";
import { projectFinancialReviewChart } from "./financial-review-chart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function percentage(value: number): string {
  return `${String(value)}%`;
}

export function FinancialReviewTrend({
  rows,
  currency,
  onSelect,
}: {
  rows: CanonicalRow[];
  currency: string;
  onSelect: (month: string) => void;
}) {
  const chart = projectFinancialReviewChart(rows);
  if (!chart)
    return (
      <Text size="sm" c="dimmed" mb="md">
        Chart unavailable for this range. Monthly amounts are shown below.
      </Text>
    );
  const { months, lines, zero } = chart;

  return (
    <Paper
      component="figure"
      withBorder
      p="md"
      className="financial-review-trend"
      aria-label="Monthly and running differences"
    >
      <Group justify="space-between" gap="sm" mb="sm">
        <Text fw={600} size="sm">
          Difference across months
        </Text>
        <Group gap="md" className="financial-review-trend-legend">
          <span>
            <i className="financial-review-monthly-key" />
            Monthly difference
          </span>
          <span>
            <i className="financial-review-running-key" />
            Running difference
          </span>
        </Group>
      </Group>
      <div className="financial-review-trend-plot">
        <span className="financial-review-zero-label" style={{ top: percentage(zero) }}>
          0.00
        </span>
        <div className="financial-review-zero-line" style={{ top: percentage(zero) }} />
        <svg
          className="financial-review-trend-line"
          viewBox="0 0 1000 200"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {lines.map((line, index) => (
            <polyline key={index} points={line} fill="none" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {months.map((point, monthIndex) => {
          const position = {
            left: percentage((monthIndex / months.length) * 100),
            width: percentage(100 / months.length),
          };
          if (!point)
            return (
              <span key={monthIndex} className="financial-review-trend-gap" style={position}>
                {MONTHS[monthIndex]}
              </span>
            );
          const month = point.row.month?.slice(0, 7) ?? "";
          const label = formatRecordMonth(month);
          const description = `${label}: Monthly difference ${formatMoney(point.row.difference, currency)}; Running difference ${formatMoney(point.row.running_difference, currency)}`;
          const barY = point.monthlyY;
          return (
            <button
              key={month}
              type="button"
              className="financial-review-trend-month"
              style={position}
              aria-label={`View chart details for ${label}`}
              title={description}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onSelect(month);
              }}
            >
              <span
                className="financial-review-trend-bar"
                style={{
                  top: percentage(Math.min(zero, barY)),
                  height: percentage(Math.abs(zero - barY)),
                }}
              />
              <span
                className="financial-review-trend-dot"
                style={{ top: percentage(point.runningY) }}
              />
              <span className="financial-review-trend-month-label">{MONTHS[monthIndex]}</span>
            </button>
          );
        })}
      </div>
      <Text component="figcaption" size="xs" c="dimmed" mt="lg">
        Difference = Finances − Data Kiosk. The running difference adds the available months from
        January. These are full mature activity months; months without source records have no
        plotted value.
      </Text>
    </Paper>
  );
}
