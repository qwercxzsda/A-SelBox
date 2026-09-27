import { LIVE_COLUMNS, liveRow } from "../api-fixtures.mjs";
import { filterRecordRows } from "../record-fixtures.mjs";
import { transactionFilterParams } from "../transaction-page-fixtures.mjs";
import { latestBucketDate, periodBucketTotals } from "../aggregate-fixtures.mjs";

export async function respondWithLatestDate(fixture, { url, user, reply }, args) {
  const entry = { user, params: url.searchParams, includeCount: args.p_include_count, args };
  fixture.latestRequests.push(entry);
  await fixture.beforeLatest(entry);
  if (fixture.latestStatus !== 200)
    return reply({ message: "Latest date fixture unavailable" }, fixture.latestStatus);
  const date = latestBucketDate(
    filterRecordRows(fixture.aggregateRowsByUser[user] ?? fixture.aggregateRows, url.searchParams),
  );
  const row = { ...liveRow("LATEST", 1, fixture.companyIds[user]), activity_date: date };
  return reply({
    rows: date
      ? [Object.fromEntries(LIVE_COLUMNS.map((column) => [column, row[column] ?? null]))]
      : [],
    total_count: null,
  });
}

export async function respondWithSummary(fixture, { request, url, user, reply }) {
  if (request.method() !== "POST" || request.headers().prefer)
    throw new Error("Summary RPC must use POST without an exact-count request");
  const args = request.postDataJSON();
  const breakdown = args.p_group_by_type;
  const params = transactionFilterParams({
    ...args,
    p_sources: [],
    p_types: [],
    p_fee_applicable: null,
    p_search_skus: null,
    p_search_types: null,
    p_search_marketplaces: null,
    p_search_sources: null,
  });
  params.set("offset", String(args.p_offset));
  params.set("limit", String(args.p_limit));
  if (args.p_currency) params.set("currency", `eq.${args.p_currency}`);
  const entry = { user, params, args, endpoint: url.pathname, includeCount: false };
  const requests = breakdown ? fixture.breakdownRequests : fixture.aggregateRequests;
  requests.push(entry);
  await (breakdown ? fixture.beforeBreakdown : fixture.beforeAggregates)(entry);
  const status = breakdown
    ? fixture.breakdownStatus
    : (fixture.aggregateStatusForRequest?.(entry) ?? fixture.aggregateStatus);
  if (status !== 200) return reply({ message: "Summary fixture unavailable" }, status);
  // Type fixtures already represent groups for the requested period, so they have no date column.
  const rowFilters = new URLSearchParams(params);
  if (breakdown) rowFilters.delete("activity_date");
  const rows =
    (breakdown ? fixture.breakdownRowsForRequest?.(entry) : undefined) ??
    filterRecordRows(
      breakdown
        ? (fixture.breakdownRowsByUser[user] ?? fixture.breakdownRows)
        : (fixture.aggregateRowsByUser[user] ?? fixture.aggregateRows),
      rowFilters,
    );
  const allRows = breakdown
    ? rows
        .filter((row) => row.currency === args.p_currency)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left.component_type), Buffer.from(right.component_type)),
        )
    : periodBucketTotals(rows, params);
  const offset = args.p_offset;
  const limit = Math.min(
    args.p_limit,
    breakdown ? fixture.breakdownPageCap : fixture.aggregatePageCap,
  );
  return reply({
    rows: allRows.slice(offset, offset + limit),
    next_offset: offset + limit < allRows.length ? offset + limit : null,
  });
}
