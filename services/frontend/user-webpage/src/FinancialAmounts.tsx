import "./FinancialAmounts.css";
import { Text, type MantineSpacing } from "@mantine/core";
import type { CurrencyTotal } from "./api";
import { formatMoney } from "./decimal";

import { FINANCIAL_AMOUNTS, financialAmountLabel, missingFeeRateCount } from "./financial-amounts";

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
          <dd>{formatMoney(total[field[0]], total.currency || null)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "N missing fee rates" near amounts, in the same warning tone as Current totals; nothing at 0. */
export function MissingFeeRateNote({
  count,
  mt,
  mb,
}: {
  count: number;
  mt?: MantineSpacing | number;
  mb?: MantineSpacing | number;
}) {
  return count > 0 ? (
    <Text size="xs" fw={500} c="var(--ui-status-warning-text)" role="note" mt={mt} mb={mb}>
      {missingFeeRateCount(count)}
    </Text>
  ) : null;
}
