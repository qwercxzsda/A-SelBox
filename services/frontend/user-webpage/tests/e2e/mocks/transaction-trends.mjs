import { sumAggregateRows } from "../aggregate-fixtures.mjs";
import { filterRecordRows } from "../record-fixtures.mjs";
import { transactionFilterParams } from "../transaction-page-fixtures.mjs";

function periodStart(timestamp, granularity) {
  const date = new Date(timestamp);
  if (granularity === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export async function respondWithTransactionTrends(fixture, { request, url, user, reply }) {
  const args = request.postDataJSON();
  const params = transactionFilterParams(args);
  const entry = { user, params, args, endpoint: url.pathname };
  fixture.trendRequests.push(entry);
  await fixture.beforeTrends(entry);
  if (fixture.trendStatus !== 200)
    return reply({ message: "Trend fixture unavailable" }, fixture.trendStatus);
  const rows = filterRecordRows(fixture.aggregateRowsByUser[user] ?? fixture.aggregateRows, params);
  const groups = new Map();
  for (const row of rows) {
    const start = periodStart(row.activity_at, args.p_granularity);
    const key = JSON.stringify([start, row.marketplace_name, row.currency, row.component_type]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const totals = [...groups.entries()]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, group]) => {
      const [start, marketplace, currency, type] = JSON.parse(key);
      return {
        period_start: start,
        marketplace_name: marketplace,
        currency,
        component_type: type,
        ...sumAggregateRows(group),
      };
    });
  const limit = Math.min(args.p_limit, fixture.trendPageCap);
  const next = args.p_offset + limit;
  return reply({
    rows: totals.slice(args.p_offset, next),
    next_offset: next < totals.length ? next : null,
  });
}
