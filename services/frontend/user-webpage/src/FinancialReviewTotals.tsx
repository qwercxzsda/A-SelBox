import { formatExactAmount, formatExactMoney } from "./decimal";
import type { ReviewTotalKey, ReviewTotals } from "./financial-review-model";

const TOTALS: readonly (readonly [ReviewTotalKey, string])[] = [
  ["finances", "Finances"],
  ["company", "Company amounts"],
  ["selbox", "SelBox types"],
  ["difference", "Differences"],
];

/** Finances and the three outcomes it splits into, each including tax with the tax beneath. */
export function FinancialReviewTotals({
  label,
  totals,
  currency,
  isPlaceholderData = false,
  isBusy = false,
}: {
  label: string;
  /** Null while the first result loads or after a failed check. */
  totals: ReviewTotals | null;
  currency: string;
  isPlaceholderData?: boolean;
  isBusy?: boolean;
}) {
  return (
    <dl
      className="financial-review-totals"
      aria-label={label}
      aria-busy={isBusy}
      data-placeholder={isPlaceholderData || undefined}
    >
      {TOTALS.map(([key, title]) => (
        <div key={key} className="financial-review-total" data-measure={key}>
          <dt>{title}</dt>
          <dd>
            <span className="financial-review-total-value">
              {totals ? formatExactMoney(totals[key].amount, currency) : "—"}
            </span>
            <span className="financial-review-total-tax">
              Tax: {totals ? formatExactAmount(totals[key].tax, currency) : "—"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
