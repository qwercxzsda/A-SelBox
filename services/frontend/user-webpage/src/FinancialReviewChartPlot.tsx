import { formatMoney } from "./decimal";
import { FinancialReviewChartMonth } from "./FinancialReviewChartMonth";
import type { ReviewChart, ReviewChartPoint } from "./financial-review-chart";
import { chartPercentage, formatFinancialReviewChartTick } from "./financial-review-chart-format";

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
  const { months, families, lines, zero } = chart;
  return (
    <div className="financial-review-trend-plot">
      <span className="financial-review-axis-currency">{currency}</span>
      {chart.ticks.map((tick) => (
        <span
          key={tick.value}
          className="financial-review-axis-label"
          style={{ top: chartPercentage(tick.y) }}
          title={formatMoney(tick.value, currency)}
        >
          {formatFinancialReviewChartTick(tick.value)}
        </span>
      ))}
      <div className="financial-review-zero-line" style={{ top: chartPercentage(zero) }} />
      <svg
        className="financial-review-trend-line"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {families.flatMap((family) =>
          family.lines.map((line, index) => (
            <polyline
              key={`${family.id}:${String(index)}`}
              className="financial-review-family-line"
              data-family-id={family.id}
              points={line}
              fill="none"
              stroke={family.color}
              strokeDasharray={family.dash}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {lines.map((line, index) => (
          <polyline
            key={index}
            className="financial-review-total-line"
            points={line}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {months.map((point, monthIndex) => {
        const position = {
          left: chartPercentage((monthIndex / months.length) * 100),
          width: chartPercentage(100 / months.length),
        };
        if (!point)
          return (
            <span key={monthIndex} className="financial-review-trend-gap" style={position}>
              {MONTHS[monthIndex]}
            </span>
          );
        return (
          <FinancialReviewChartMonth
            key={point.month}
            point={point}
            shortLabel={MONTHS[monthIndex]}
            position={position}
            currency={currency}
            zero={zero}
            families={families}
            inspected={point === inspected}
            onInspect={onInspect}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
