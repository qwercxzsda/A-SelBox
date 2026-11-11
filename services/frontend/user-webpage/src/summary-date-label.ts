import type { DateRange } from "./summary-periods.ts";

const fullDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** Keep a date-range control short without dropping a year or a boundary. */
export function summaryDateLabel({ from, to }: DateRange): string {
  if (!from) return to ? `Through ${fullDate.format(new Date(`${to}T00:00:00Z`))}` : "Choose dates";
  const start = new Date(`${from}T00:00:00Z`);
  if (!to) return `From ${fullDate.format(start)}`;
  const end = new Date(`${to}T00:00:00Z`);
  if (from === to) return fullDate.format(start);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${month.format(start)} ${String(start.getUTCDate())}–${String(end.getUTCDate())}, ${String(end.getUTCFullYear())}`;
  if (from.slice(0, 4) === to.slice(0, 4))
    return `${monthDay.format(start)} – ${fullDate.format(end)}`;
  return `${fullDate.format(start)} – ${fullDate.format(end)}`;
}
