/** One label and field mapping for totals, type subtotals, and individual records. */
export const FINANCIAL_AMOUNTS = [
  ["reportedAmount", "Reported amount", "source_amount"],
  ["serviceFee", "Service fee", "fee_amount"],
  ["companyAmount", "Company amount", "company_amount"],
] as const;

export function financialAmountLabel(
  [key, label]: (typeof FINANCIAL_AMOUNTS)[number],
  incomplete: boolean,
): string {
  return key === "companyAmount" && incomplete ? "Known company amount" : label;
}

/** The one wording for transactions whose company amount is unknown. */
export function missingFeeRateCount(count: number): string {
  return `${count.toLocaleString("en-US")} missing fee ${count === 1 ? "rate" : "rates"}`;
}
