import { AmountTrendPlot, type AmountTrendPoint } from "./AmountTrendPlot";
import { formatRecordMonth } from "./date-display";
import { formatMoney } from "./decimal";
import { chartFamilyScopeLabel } from "./financial-review-chart-context";
import type { ReviewChart, ReviewChartPoint } from "./financial-review-chart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function FinancialReviewChartPlot({
  chart,
  currency,
  inspected,
  onInspect,
  onSelect,
}: {
  chart: ReviewChart;
  currency: string;
  inspected: ReviewChartPoint;
  onInspect: (month: string) => void;
  onSelect: (month: string) => void;
}) {
  const familyById = new Map(chart.families.map((family) => [family.id, family]));
  const points: (AmountTrendPoint | null)[] = chart.months.map((point, index) => {
    if (!point) return null;
    const label = formatRecordMonth(point.month);
    const segments = point.segments.map((segment) => {
      const family = familyById.get(segment.familyId);
      const context = chartFamilyScopeLabel(family);
      return {
        ...segment,
        lineY: segment.runningY,
        description: `${family?.label ?? segment.familyId}${context ? ` · ${context}` : ""}: Monthly gap contribution ${formatMoney(segment.sourceGap, currency)}; Running gap contribution ${formatMoney(segment.runningSourceGap, currency)}`,
      };
    });
    return {
      id: point.month,
      shortLabel: MONTHS[index],
      accessibleLabel: `${MONTHS[index]}: View chart details for ${label}`,
      description: [
        `${label}: Monthly source gap ${formatMoney(point.row.difference, currency)}; Running source gap ${formatMoney(point.row.running_difference, currency)}`,
        ...segments.map((segment) => segment.description),
      ].join("\n"),
      amountY: point.monthlyY,
      lineY: point.runningY,
      segments,
    };
  });
  return (
    <AmountTrendPlot
      {...{ points, currency, onInspect, onSelect }}
      gapLabels={MONTHS}
      series={chart.families}
      lines={chart.lines}
      zero={chart.zero}
      ticks={chart.ticks}
      inspectedId={inspected.month}
    />
  );
}
