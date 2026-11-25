import { AmountTrendPlot, type AmountTrendPoint } from "./AmountTrendPlot";
import type { ReviewReason } from "./api/financial-review";
import { REVIEW_REASON_LABELS } from "./categories";
import { formatRecordMonth } from "./date-display";
import { formatExactMoney } from "./decimal";
import { REASON_COLORS, type DifferenceChart } from "./financial-review-chart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Signed monthly bars stacked by reason, with one running difference line. */
export function FinancialReviewChartPlot({
  chart,
  currency,
  inspectedMonth,
  onInspect,
  onSelect,
}: {
  chart: DifferenceChart;
  currency: string;
  inspectedMonth: string;
  onInspect: (month: string) => void;
  onSelect: (month: string, reason: ReviewReason | null) => void;
}) {
  const money = (value: string) => formatExactMoney(value, currency);
  const points = chart.points.map((point, index): AmountTrendPoint | null => {
    if (!point) return null;
    const label = formatRecordMonth(point.month);
    const segments = point.segments.map(({ reason, amount, top, height }) => ({
      familyId: reason,
      top,
      height,
      lineY: null,
      description: `${REVIEW_REASON_LABELS[reason]}: ${money(amount)}`,
      actionLabel: `Show ${REVIEW_REASON_LABELS[reason]} in ${label}`,
    }));
    return {
      id: point.month,
      shortLabel: MONTHS[index],
      // The visible month abbreviation starts the name, as speech input expects.
      accessibleLabel: `${MONTHS[index]}: Open ${label}`,
      opensDialog: true,
      description: [
        `${label}: Monthly difference ${money(point.difference)}; Running difference ${money(point.runningDifference)}`,
        ...segments.map(({ description }) => description),
      ].join("\n"),
      amountY: point.monthlyY,
      lineY: point.runningY,
      segments,
    };
  });
  return (
    <AmountTrendPlot
      points={points}
      gapLabels={MONTHS}
      series={chart.reasons.map((reason) => ({
        id: reason,
        color: REASON_COLORS[reason],
        dash: "",
        lines: [],
      }))}
      lines={chart.lines}
      zero={chart.zero}
      ticks={chart.ticks}
      currency={currency}
      inspectedId={inspectedMonth}
      onInspect={onInspect}
      onSelect={(month) => {
        onSelect(month, null);
      }}
      onSelectSegment={(month, reason) => {
        onSelect(month, chart.reasons.find((code) => code === reason) ?? null);
      }}
      keyboardNavigation
    />
  );
}
