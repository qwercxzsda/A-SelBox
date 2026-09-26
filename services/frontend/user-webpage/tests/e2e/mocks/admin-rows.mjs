import { DATASET_CONFIG } from "../../../src/api/config.ts";
import { filterRecordRows, sortRecordRows } from "../record-fixtures.mjs";

export function respondWithAdminRows(fixture, { request, url, user, reply, csvReply, track }) {
  if (fixture.roles[user] !== "operator") return reply({ message: "Administrator required" }, 403);
  const dataset = url.pathname === "/rest/v1/app_accounts" ? "accounts" : "payouts";
  const entry = {
    user,
    dataset,
    params: url.searchParams,
    transport: "rest",
    completed: false,
    failure: null,
  };
  track(request, entry);
  const counting = request.method() === "HEAD";
  (counting ? fixture.countRequests : fixture.requests).push(entry);
  const source =
    dataset === "payouts"
      ? fixture.payoutRows
      : Object.keys(fixture.roles).map((id) => ({
          user_id: id,
          access_role: fixture.roles[id],
          company_id: fixture.roles[id] === "operator" ? null : fixture.companyIds[id],
          created_at: "2026-09-01T00:00:00Z",
        }));
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
