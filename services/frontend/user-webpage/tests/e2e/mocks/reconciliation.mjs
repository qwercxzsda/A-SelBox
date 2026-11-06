import { sourceRequestParams, sourceTotalsResponse } from "./source-totals.mjs";

/** Saved source aggregates use the report's exact scope and independent raw categories. */
export async function respondWithReconciliation(fixture, { request, url, user, reply, track }) {
  const endpoint = url.pathname.split("/").at(-1);
  if (request.method() !== "POST") return reply({}, 405);
  const args = request.postDataJSON();
  const entry = { endpoint, params: sourceRequestParams(args), args, user, completed: false };
  fixture.reconciliationRequests.push(entry);
  track(request, entry);
  if (fixture.roles[user] !== "administrator") return reply({}, 403);
  await fixture.beforeReconciliation(entry);
  const status = fixture.reconciliationStatusForRequest?.(entry) ?? fixture.reconciliationStatus;
  if (status !== 200) return reply({}, status);
  const report = fixture.payoutRows.find((row) => row.id === args.p_report_id);
  if (!report) return reply({}, 400);
  const scope = {
    report_id: report.id,
    start_date: report.start_date,
    end_date: report.end_date,
    marketplace_name: report.marketplace_name ?? null,
    currency: report.currency ?? null,
  };
  return reply(
    sourceTotalsResponse(
      fixture.reportSourceRows.filter((row) => row.report_id === report.id),
      scope,
      args,
      null,
      fixture.reportSourceCoverage,
    ),
  );
}
