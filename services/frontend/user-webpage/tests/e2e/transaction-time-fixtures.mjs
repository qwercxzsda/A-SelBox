import timeZones from "../../src/generated/marketplace-timezones.json" with { type: "json" };

function dayEnd(date, marketplace) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const wallTime = next.getTime();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZones[marketplace],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = wallTime;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );
    const local = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant += wallTime - local;
  }
  return new Date(instant - 1).toISOString().replace(".999Z", ".999999Z");
}

/** Fixture Finances records default to a known noon-UTC posting; boundary tests provide exact instants. */
export function timestampedTransaction(row) {
  return {
    ...row,
    activity_at:
      row.activity_at ??
      (row.source === "DATA_KIOSK"
        ? dayEnd(row.activity_date, row.marketplace_name)
        : `${row.activity_date}T12:00:00.000000Z`),
  };
}

/** Raw-source pages retain local dates but expose the same reporting instant as Transactions. */
export function timestampedSource(row, dataset) {
  return {
    ...row,
    activity_at:
      row.activity_at ??
      (dataset === "finances"
        ? new Date(row.posted_at).toISOString().replace(".000Z", ".000000Z")
        : dayEnd(row.activity_date, row.marketplace_name)),
  };
}
