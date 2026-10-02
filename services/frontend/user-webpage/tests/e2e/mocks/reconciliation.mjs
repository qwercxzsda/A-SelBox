import { sortRecordRows } from "../record-fixtures.mjs";

const COLUMNS = [
  "report_id",
  "currency",
  "settlement_category_amount",
  "selbox_category_amount",
  "data_kiosk_settlement_control",
  "data_kiosk_category_amount",
  "difference",
  "settlement_total",
  "accounted_total",
  "source_group_count",
];

/** Saved report controls stay separate from the current category review fixtures. */
export async function respondWithReconciliation(
  fixture,
  { request, url, user, reply, csvReply, track },
) {
  const endpoint = url.pathname.split("/").at(-1);
  const entry = { endpoint, params: url.searchParams, user, completed: false };
  fixture.reconciliationRequests.push(entry);
  track(request, entry);
  if (fixture.roles[user] !== "operator") return reply({}, 403);
  await fixture.beforeReconciliation(entry);
  const status = fixture.reconciliationStatusForRequest?.(entry) ?? fixture.reconciliationStatus;
  if (status !== 200) return reply({}, status);
  const reportId = url.searchParams.get("report_id")?.slice(3);
  const rows = sortRecordRows(
    fixture.payoutReconciliationTotals.filter((row) => row.report_id === reportId),
    url.searchParams,
  );
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  const selected = url.searchParams.get("select");
  const columns = selected && selected !== "*" ? selected.split(",") : COLUMNS;
  return csvReply(columns, rows.slice(offset, offset + limit), rows.length, offset);
}
