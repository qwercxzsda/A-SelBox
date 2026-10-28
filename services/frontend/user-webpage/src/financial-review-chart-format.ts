import { formatAmount, sumExactDecimals } from "./decimal.ts";

export function chartPercentage(value: number): string {
  return `${String(value)}%`;
}

/** Compact axis text from decimal digits; the complete exact amount stays in the tick title. */
export function formatFinancialReviewChartTick(value: string): string {
  const amount = sumExactDecimals([value]);
  if (amount === null) throw new Error("Chart tick requires an amount");
  if (amount === "0") return "0";
  const negative = amount.startsWith("-");
  const [integer, fraction = ""] = (negative ? amount.slice(1) : amount).split(".");
  const sign = negative ? "-" : "";
  const compact = (digits: string) =>
    formatAmount(`${sign}${digits}`)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1");
  if (integer.length > 15)
    return `${compact(`${integer[0]}.${integer.slice(1)}${fraction}`)}e${String(integer.length - 1)}`;
  for (const [scale, suffix] of [
    [12, "T"],
    [9, "B"],
    [6, "M"],
    [3, "k"],
  ] as const) {
    if (integer.length > scale)
      return `${compact(`${integer.slice(0, -scale)}.${integer.slice(-scale)}${fraction}`)}${suffix}`;
  }
  if (integer === "0" && fraction.startsWith("00")) {
    const position = fraction.search(/[1-9]/);
    return `${compact(`${fraction[position]}.${fraction.slice(position + 1)}`)}e-${String(position + 1)}`;
  }
  return compact(`${integer}.${fraction}`);
}
