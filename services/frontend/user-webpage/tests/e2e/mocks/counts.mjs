import { filterRecordRows } from "../record-fixtures.mjs";
import {
  transactionFilterParams,
  sourceTransactionFilterParams,
} from "../transaction-page-fixtures.mjs";

export async function respondWithCount(fixture, { request, url, user, reply, track }) {
  const args = request.postDataJSON();
  const dataset =
    url.pathname === "/rest/v1/rpc/source_transaction_count" ? args.p_dataset : "live";
  const params =
    dataset === "live" ? transactionFilterParams(args) : sourceTransactionFilterParams(args);
  const sourceRows = {
    live: fixture.liveRows,
    settlement: fixture.settlementRows,
    data_kiosk: fixture.kioskRows,
  }[dataset];
  const actualCount =
    sourceRows === null
      ? params.get("or")
        ? fixture.searchCount
        : fixture.totalCount
      : filterRecordRows(sourceRows, params).length;
  const count =
    fixture.countTotalForRequest?.({ user, dataset, params, args, count: actualCount }) ??
    actualCount;
  const entry = {
    user,
    dataset,
    args,
    params,
    count,
    transport: "rpc",
    completed: false,
    failure: null,
  };
  fixture.countRequests.push(entry);
  track(request, entry);
  await fixture.beforeCount(entry);
  const status = fixture.countStatusForRequest(entry);
  if (status !== 200) return reply({ message: "Count fixture unavailable" }, status);
  return reply(String(count));
}
