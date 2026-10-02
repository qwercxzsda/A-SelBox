import {
  PAYOUT_COMPONENT_COLUMNS,
  PAYOUT_MARKETPLACE_COLUMNS,
  PAYOUT_RECONCILIATION_COLUMNS,
} from "../../../src/api/payouts.ts";
import { sumExactDecimals } from "../../../src/decimal.ts";
import { filterRecordRows } from "../record-fixtures.mjs";

export async function respondWithPayouts(fixture, { url, request, user, reply, csvReply }) {
  if (url.pathname.endsWith("/payout_report_policy"))
    return reply(
      fixture.payoutPolicy ?? {
        mature_cutoff_date: "2026-07-27",
        latest_month: "2026-06-01",
        mature_cutoff_months: 2,
      },
      fixture.payoutPolicyStatus ?? 200,
    );
  const totalsArgs = url.pathname.endsWith("/payout_report_totals") ? request.postDataJSON() : null;
  const reportId = totalsArgs?.p_report_id ?? url.searchParams.get("report_id").slice(3);
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
  if (totalsArgs) {
    const report = fixture.payoutRows.find((row) => row.id === reportId);
    const components = (fixture.payoutComponents ?? []).filter(
      (row) => visible && row.report_id === reportId && row.authoritative === "true",
    );
    const types = [...new Set(components.map((row) => row.component_type ?? "UNSPECIFIED"))].sort();
    const totals = types.map((type) => {
      const rows = components.filter((row) => (row.component_type ?? "UNSPECIFIED") === type);
      return {
        currency: report.currency,
        component_type: type,
        reported_amount: sumExactDecimals(rows.map((row) => row.source_amount ?? null)),
        service_fee: sumExactDecimals(rows.map((row) => row.fee_amount ?? null)),
        company_amount: sumExactDecimals(rows.map((row) => row.company_amount ?? null)),
        row_count: String(rows.length),
        known_company_count: String(rows.filter((row) => row.company_amount !== null).length),
      };
    });
    return reply({
      rows: totals.slice(totalsArgs.p_offset, totalsArgs.p_offset + totalsArgs.p_limit),
      next_offset: null,
    });
  }
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
  fixture.payoutComponentRequests.push({ reportId, authoritative, user, params: url.searchParams });
  const filters = new URLSearchParams();
  if (url.searchParams.has("component_type"))
    filters.set("component_type", url.searchParams.get("component_type"));
  const rows = filterRecordRows(
    (fixture.payoutComponents ?? []).filter(
      (row) =>
        visible &&
        row.report_id === reportId &&
        row.authoritative === authoritative &&
        (fixture.roles[user] === "operator" || row.authoritative === "true"),
    ),
    filters,
  );
  const offset = Number(url.searchParams.get("offset"));
  return csvReply(PAYOUT_COMPONENT_COLUMNS, rows.slice(offset, offset + 50), rows.length, offset);
}
