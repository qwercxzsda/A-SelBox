import "./FinancialAmounts.css";
import type { CurrencyTotal } from "./api";
import { formatExactMoney } from "./decimal";

import { FINANCIAL_AMOUNTS } from "./view-model";

export function FinancialAmounts({
  total,
  className = "type-breakdown-amounts",
}: {
  total: CurrencyTotal;
  className?: string;
}) {
  return (
    <dl className={className}>
      {FINANCIAL_AMOUNTS.map(([field, label]) => (
        <div key={field}>
          <dt>
            {field === "companyAmount" && total.missingFeeCount > 0
              ? "Known company amount"
              : label}
          </dt>
          <dd>{formatExactMoney(total[field], total.currency)}</dd>
        </div>
      ))}
    </dl>
  );
}
