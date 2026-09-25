export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodDefinition {
  label: string;
  range: DateRange;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function estimateMonthRange(latestDate: string): DateRange {
  const start = new Date(`${latestDate}T00:00:00Z`);
  const followingDay = new Date(start);
  followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  const monthEndsOnLatestDate = followingDay.getUTCDate() === 1;
  start.setUTCDate(1);
  if (!monthEndsOnLatestDate) start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from: isoDate(start), to: isoDate(end) };
}

export function selectedPeriod(range: DateRange): PeriodDefinition | null {
  const { from, to } = range;
  if (!from && !to) return null;
  const label = !from
    ? `Through ${formatDate(to)}`
    : !to
      ? `From ${formatDate(from)}`
      : from === to
        ? formatDate(from)
        : `${formatDate(from)} – ${formatDate(to)}`;
  return { label, range };
}

export function summaryPeriods(latestDate: string | null) {
  if (latestDate === null) return { day: null, month: null };
  const monthRange = estimateMonthRange(latestDate);
  return {
    day: { range: { from: latestDate, to: latestDate }, label: formatDate(latestDate) },
    month: {
      range: monthRange,
      label: monthFormatter.format(new Date(`${monthRange.from}T00:00:00Z`)),
    },
  };
}
