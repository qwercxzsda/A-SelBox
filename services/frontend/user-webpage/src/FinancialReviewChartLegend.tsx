import type { ReviewReason } from "./api/financial-review";
import { REVIEW_REASON_LABELS } from "./categories";
import { formatExactMoney } from "./decimal";
import { legendReasons, REASON_COLORS } from "./financial-review-chart";
import type { ReviewBreakdown } from "./financial-review-model";

/** Each plotted reason with its year total, largest first; empty, it keeps its reserved rows. */
export function FinancialReviewChartLegend({
  reasons,
  currency,
}: {
  reasons: readonly ReviewBreakdown<ReviewReason>[];
  currency: string;
}) {
  if (!reasons.length) return <div className="financial-review-legend" aria-hidden="true" />;
  return (
    <ul className="financial-review-legend" aria-label="Reasons with year totals">
      {legendReasons(reasons).map(({ code, amount }) => (
        <li key={code} data-reason={code}>
          <span
            className="financial-review-swatch"
            style={{ backgroundColor: REASON_COLORS[code] }}
            aria-hidden="true"
          />
          <span className="financial-review-legend-label">{REVIEW_REASON_LABELS[code]}</span>{" "}
          <span className="financial-review-legend-total">
            {formatExactMoney(amount, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
