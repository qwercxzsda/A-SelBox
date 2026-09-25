import "./FinancialAmounts.css";
import type { CurrencyTotal } from "./api";
import { formatExactMoney } from "./decimal";

const AMOUNTS = [
  ["reportedAmount", "Reported amount"],
  ["serviceFee", "Service fee"],
  ["companyAmount", "Company amount"],
] as const;

export function FinancialAmounts({
  total,
  className = "type-breakdown-amounts",
}: {
  total: CurrencyTotal;
  className?: string;
}) {
  return (
    <dl className={className}>
      {AMOUNTS.map(([field, label]) => (
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
