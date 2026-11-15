import { formatMoney } from "./decimal.ts";
import { FINANCIAL_AMOUNTS } from "./financial-amounts.ts";

export type TrendAmountField = (typeof FINANCIAL_AMOUNTS)[number][0];

export function trendAmountText(
  value: string | null,
  currency: string,
  field: TrendAmountField,
  missingFeeCount: number,
): string {
  if (value === null) return "Unknown";
  const incomplete = field !== "reportedAmount" && missingFeeCount > 0;
  return `${formatMoney(value, currency)}${incomplete ? " (known subtotal)" : ""}`;
}

export function trendAmountTitle(
  value: string | null,
  currency: string,
  field: TrendAmountField,
  missingFeeCount: number,
): string {
  if (value === null) return "Unknown";
  return `${value} ${currency}${field !== "reportedAmount" && missingFeeCount > 0 ? " (known subtotal)" : ""}`;
}

export function describeTrendAmounts(
  values: Partial<Record<TrendAmountField, string | null>> | undefined,
  currency: string,
  missingFeeCount: number,
): string {
  return FINANCIAL_AMOUNTS.map(
    ([field, label]) =>
      `${label} ${trendAmountText(values?.[field] ?? null, currency, field, missingFeeCount)}`,
  ).join("; ");
}
