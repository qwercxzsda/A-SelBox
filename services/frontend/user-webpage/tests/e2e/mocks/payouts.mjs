import {
  PAYOUT_COMPONENT_COLUMNS,
  PAYOUT_MARKETPLACE_COLUMNS,
  PAYOUT_RECONCILIATION_COLUMNS,
} from "../../../src/api/payouts.ts";

export async function respondWithPayouts(fixture, { request, url, user, reply, csvReply }) {
  if (url.pathname.endsWith("/payout_report_policy"))
    return reply({
      mature_cutoff_date: "2026-07-27",
      latest_month: "2026-06-01",
      mature_cutoff_months: 2,
    });
  if (url.pathname.endsWith("/generate_company_payout_reports")) {
    if (fixture.roles[user] !== "operator") return reply({}, 403);
    const args = request.postDataJSON();
    fixture.generatedPayouts ??= [];
    fixture.generatedPayouts.push(args);
    if (fixture.payoutGenerationStatus)
      return reply(fixture.payoutGenerationError ?? {}, fixture.payoutGenerationStatus);
    const id = "0198b50b-701a-7000-8000-000000000099";
    const results = fixture.payoutGenerationResults ?? [
      { report_id: id, created: !fixture.payoutRows.some((row) => row.id === id) },
    ];
    for (const { report_id: reportId, created } of results) {
      if (created)
        fixture.payoutRows.push({
          id: reportId,
          company_id: args.p_company_id,
          seller_namespace: "seller-a",
          start_date: args.p_month,
          end_date: "2026-06-30",
          source_amount: "100",
          fee_amount: "-5",
          company_amount: "95",
          created_at: "2026-09-27T00:00:00Z",
          currency: "USD",
          ...fixture.payoutGeneratedReport,
        });
    }
    return reply(results);
  }
  const reportId = url.searchParams.get("report_id").slice(3);
  if (url.pathname.endsWith("/payout_report_reconciliation")) {
    if (fixture.roles[user] !== "operator") return reply({}, 403);
    const rows = (fixture.payoutReconciliation ?? []).filter((row) => row.report_id === reportId);
    const offset = Number(url.searchParams.get("offset"));
    return csvReply(
      PAYOUT_RECONCILIATION_COLUMNS,
      rows.slice(offset, offset + 50),
      rows.length,
      offset,
    );
  }
  const visible = fixture.payoutRows.some(
    (row) =>
      row.id === reportId &&
      (fixture.roles[user] === "operator" || row.company_id === fixture.companyIds[user]),
  );
  if (url.pathname.endsWith("/payout_report_marketplace_totals")) {
    await fixture.beforePayoutMarketplaceTotals?.();
    if (fixture.payoutMarketplaceTotalsStatus)
      return reply({}, fixture.payoutMarketplaceTotalsStatus);
    const rows = (fixture.payoutMarketplaceTotals ?? []).filter(
      (row) => visible && row.report_id === reportId,
    );
    return csvReply(PAYOUT_MARKETPLACE_COLUMNS, rows.slice(0, 25), rows.length);
  }
  const authoritative = url.searchParams.get("authoritative").slice(3);
  const rows = (fixture.payoutComponents ?? []).filter(
    (row) => visible && row.report_id === reportId && row.authoritative === authoritative,
  );
  const offset = Number(url.searchParams.get("offset"));
  return csvReply(PAYOUT_COMPONENT_COLUMNS, rows.slice(offset, offset + 50), rows.length, offset);
}
