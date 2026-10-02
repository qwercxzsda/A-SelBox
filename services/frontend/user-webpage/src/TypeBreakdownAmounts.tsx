import type { CurrencyTotal } from "./api/types";
import { formatExactMoney } from "./decimal";
import { FINANCIAL_AMOUNTS, financialAmountLabel } from "./financial-amounts";

/** Category rows and their total expose the same amounts as the main total. */
export function TypeBreakdownAmounts({ total, id }: { total: CurrencyTotal; id?: string }) {
  return (
    <span className="type-breakdown-group-amounts" id={id}>
      {FINANCIAL_AMOUNTS.map((field) => (
        <span key={field[0]} data-amount={field[0]}>
          <span className="type-breakdown-group-field">
            {financialAmountLabel(field, total.missingFeeCount > 0)}
          </span>
          <span className="type-breakdown-group-value">
            {formatExactMoney(total[field[0]], total.currency)}
          </span>
        </span>
      ))}
    </span>
  );
}
