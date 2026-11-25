import type { DateRange } from "./summary-periods.ts";

/** Day ranges use the one day format, YYYY-MM-DD, with both boundaries. */
export function summaryDateLabel({ from, to }: DateRange): string {
  if (!from) return to ? `Through ${to}` : "Choose dates";
  if (!to) return `From ${from}`;
  return from === to ? from : `${from} – ${to}`;
}
