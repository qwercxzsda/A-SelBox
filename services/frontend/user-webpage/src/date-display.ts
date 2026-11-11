const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatRecordMonth(value: string): string {
  const month = value.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return value;
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

/** Parse JSON/CSV timestamps only when the source includes an explicit offset. */
export function parseRecordTimestamp(value: string): Date | null {
  const parts =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!parts) return null;
  const [, day, time, offset] = parts;
  const zone =
    offset === "Z" || offset.includes(":")
      ? offset
      : offset.length === 3
        ? `${offset}:00`
        : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const parsed = new Date(`${day}T${time}${zone}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Keep calendar dates intact; omit the UTC suffix when the surrounding label supplies it. */
export function formatRecordDate(
  value: string,
  { includeTimeZone = true }: { includeTimeZone?: boolean } = {},
): string {
  const parsed = parseRecordTimestamp(value);
  if (!parsed) return value;
  const timestamp = parsed.toISOString().slice(0, 19).replace("T", " ");
  return includeTimeZone ? `${timestamp} UTC` : timestamp;
}
