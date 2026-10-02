import "./FinancialAmounts.css";
import type { CurrencyTotal } from "./api";
import { formatExactMoney } from "./decimal";

import { FINANCIAL_AMOUNTS, financialAmountLabel } from "./financial-amounts";

export function FinancialAmounts({
  total,
  className = "financial-amounts",
}: {
  total: CurrencyTotal;
  className?: string;
}) {
  return (
    <dl className={className}>
      {FINANCIAL_AMOUNTS.map((field) => (
        <div key={field[0]}>
          <dt>{financialAmountLabel(field, total.missingFeeCount > 0)}</dt>
          <dd>{formatExactMoney(total[field[0]], total.currency || null)}</dd>
        </div>
      ))}
    </dl>
  );
}
