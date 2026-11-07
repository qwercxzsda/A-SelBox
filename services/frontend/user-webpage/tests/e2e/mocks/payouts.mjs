import { sumExactDecimals } from "../../../src/decimal.ts";

function reportRecords(fixture, report) {
  return fixture.payoutRecords
    .filter((row) => row.report_id === report.id)
    .map((row) => {
      if (!row.source_row_id || Object.hasOwn(row, "id") || Object.hasOwn(row, "created_at"))
        throw new Error(
          "Payout record fixtures require source identity, without stored-row fields",
        );
      const field = (key, fallback) => (Object.hasOwn(row, key) ? row[key] : fallback);
      return {
        report_id: report.id,
        source: row.source ?? "FINANCES",
        authoritative: row.authoritative ?? "true",
        source_row_id: row.source_row_id,
        source_version_id: row.source_version_id ?? "source-version",
        source_identity_id: row.source_identity_id ?? "source-identity",
        sku_id: row.sku_id ?? "source-sku",
        terms_version_id: row.terms_version_id ?? "saved-terms",
        fee_period_id: row.fee_period_id ?? null,
        sku: field("sku", "PAYOUT-SKU"),
        marketplace_name: field(
          "marketplace_name",
          report.marketplace_name === undefined ? "Amazon.com" : report.marketplace_name,
        ),
        activity_date: field("activity_date", report.start_date),
        component_type: row.component_type ?? "UNSPECIFIED",
        currency: field("currency", report.currency),
        source_amount: field("source_amount", "0"),
        quantity: row.quantity ?? null,
        fee_base: row.fee_base ?? null,
        fee_rate_percent: row.fee_rate_percent ?? null,
        fee_amount: row.fee_amount ?? null,
        company_amount: row.company_amount ?? null,
        resolution_status: row.resolution_status ?? "APPLIED",
      };
    });
}

export async function respondWithPayouts(fixture, { url, request, user, reply }) {
  if (url.pathname.endsWith("/payout_report_policy"))
    return reply(
      fixture.payoutPolicy ?? {
        mature_cutoff_date: "2026-07-27",
        latest_month: "2026-06-01",
        mature_cutoff_months: 2,
      },
      fixture.payoutPolicyStatus ?? 200,
    );
  if (request.method() !== "POST") return reply({}, 405);
  const args = request.postDataJSON();
  const reportId = args.p_report_id;
  const report = fixture.payoutRows.find((row) => row.id === reportId);
  const administrator = fixture.roles[user] === "administrator";
  if (!report || (!administrator && report.company_id !== fixture.companyIds[user]))
    return reply({ code: "42501", message: "Report access required" }, 403);
  const records = reportRecords(fixture, report);
  const offset = args.p_offset ?? 0;
  if (url.pathname.endsWith("/payout_report_totals")) {
    const authoritative = records.filter((row) => row.authoritative === "true");
    const types = [...new Set(authoritative.map((row) => row.component_type))].sort();
    const rows = args.p_group_by_type
      ? types.map((type) => {
          const group = authoritative.filter((row) => row.component_type === type);
          return {
            currency: report.currency,
            component_type: type,
            reported_amount: sumExactDecimals(group.map((row) => row.source_amount)),
            service_fee: sumExactDecimals(group.map((row) => row.fee_amount)),
            company_amount: sumExactDecimals(group.map((row) => row.company_amount)),
            row_count: String(group.length),
            known_company_count: String(group.filter((row) => row.company_amount !== null).length),
          };
        })
      : report.currency === null
        ? []
        : [
            {
              currency: report.currency,
              reported_amount: report.source_amount,
              service_fee: report.fee_amount,
              company_amount: report.company_amount,
              row_count: String(authoritative.length),
              known_company_count: String(authoritative.length),
            },
          ];
    const limit = args.p_limit ?? 1000;
    return reply({
      rows: rows.slice(offset, offset + limit),
      next_offset: offset + limit < rows.length ? offset + limit : null,
    });
  }
  if (typeof args.p_authoritative !== "boolean") return reply({}, 400);
  if (!administrator && !args.p_authoritative)
    return reply({ code: "42501", message: "Report access required" }, 403);
  const authoritative = String(args.p_authoritative);
  fixture.payoutRecordRequests.push({ reportId, authoritative, user, args });
  const rows = records
    .filter(
      (row) =>
        row.authoritative === authoritative &&
        (!args.p_types?.length || args.p_types.includes(row.component_type)),
    )
    .sort(
      (a, b) =>
        b.activity_date.localeCompare(a.activity_date) ||
        b.source.localeCompare(a.source) ||
        b.source_row_id.localeCompare(a.source_row_id),
    );
  const limit = args.p_limit ?? 50;
  return reply({ rows: rows.slice(offset, offset + limit), total_count: String(rows.length) });
}
