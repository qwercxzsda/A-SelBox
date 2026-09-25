import { LIVE_COLUMNS, liveRow } from "../api-fixtures.mjs";
import { filterRecordRows, sortRecordRows } from "../record-fixtures.mjs";
import { amountOrderLimitExceeded, AMOUNT_ORDER_LIMIT_RESPONSE } from "./amount-ordering.mjs";

export async function respondWithTransactions(
  fixture,
  { request, url, user, reply, track },
  transactionArgs,
) {
  const entry = {
    user,
    params: url.searchParams,
    dataset: "live",
    transport: "rpc",
    args: transactionArgs,
    completed: false,
    failure: null,
  };
  track(request, entry);
  fixture.requests.push(entry);
  const prefix = fixture.prefixes[user];
  await fixture.beforeDataset(entry);
  if (fixture.status !== 200) return reply({ message: "Denied fixture request" }, fixture.status);
  const offset = Number(url.searchParams.get("offset"));
  const limit = Number(url.searchParams.get("limit"));
  const search = url.searchParams.get("or") ?? "";
  const filteredRows =
    fixture.liveRows === null
      ? undefined
      : sortRecordRows(filterRecordRows(fixture.liveRows, url.searchParams), url.searchParams);
  const count = filteredRows?.length ?? (search ? fixture.searchCount : fixture.totalCount);
  if (amountOrderLimitExceeded(fixture, entry, count))
    return reply(AMOUNT_ORDER_LIMIT_RESPONSE, 400);
  const rows =
    filteredRows?.slice(offset, offset + limit) ??
    Array.from({ length: Math.min(limit, Math.max(0, count - offset)) }, (_, index) =>
      liveRow(
        search.includes("FRESH") ? "FRESH" : search.includes("STALE") ? "STALE" : prefix,
        offset + index + 1,
        fixture.companyIds[user],
      ),
    );
  return reply({
    rows: rows.map((row) =>
      Object.fromEntries(LIVE_COLUMNS.map((column) => [column, row[column] ?? null])),
    ),
    total_count: transactionArgs.p_include_count ? String(count) : null,
  });
}
