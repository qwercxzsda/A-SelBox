import { DATASET_CONFIG } from "../../../src/api/config.ts";
import { filterRecordRows, sortRecordRows } from "../record-fixtures.mjs";

export function respondWithWorkspaceLists(fixture, { request, url, user, reply, csvReply, track }) {
  const dataset = url.pathname === "/rest/v1/app_accounts" ? "accounts" : "payouts";
  if (fixture.roles[user] !== "operator" && dataset === "accounts")
    return reply({ message: "Administrator required" }, 403);
  const entry = {
    user,
    dataset,
    params: url.searchParams,
    transport: "rest",
    endpoint: url.pathname,
    completed: false,
    failure: null,
  };
  track(request, entry);
  const counting = request.method() === "HEAD";
  (counting ? fixture.countRequests : fixture.requests).push(entry);
  let source =
    dataset === "payouts"
      ? fixture.payoutRows.filter(
          (row) =>
            fixture.roles[user] === "operator" || row.company_id === fixture.companyIds[user],
        )
      : Object.keys(fixture.roles).map((id) => ({
          user_id: id,
          access_role: fixture.roles[id],
          company_id: fixture.roles[id] === "operator" ? null : fixture.companyIds[id],
          created_at: "2026-09-01T00:00:00Z",
        }));
  if (url.pathname.endsWith("/latest_company_payout_reports")) {
    const sorted = sortRecordRows(
      source,
      new URLSearchParams({ order: "created_at.desc,id.desc" }),
    );
    source = [
      ...new Map(
        sorted
          .map((row) => [JSON.stringify([row.company_id, row.start_date, row.currency]), row])
          .reverse(),
      ).values(),
    ];
  }
  const rows = sortRecordRows(filterRecordRows(source, url.searchParams), url.searchParams);
  const offset = Number(url.searchParams.get("offset"));
  const limit = Number(url.searchParams.get("limit"));
  return csvReply(
    DATASET_CONFIG[dataset].selectColumns,
    rows.slice(offset, offset + limit),
    rows.length,
    offset,
    request.headers().prefer?.includes("count=exact") ?? false,
  );
}
