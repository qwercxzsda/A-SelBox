// Exercise the real frontend client against the synthetic stack owned by test_frontend_client.py.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stdout } from "node:process";
import { createApiClient } from "../../src/api/client.ts";
import { assignmentKey } from "../../src/api/assignment-types.ts";
import { DEFAULT_ASSIGNMENT_MEMO } from "../../src/api/assignments.ts";
import { DATASET_CONFIG } from "../../src/api/config.ts";
import { compareDecimals } from "../../src/decimal.ts";
import { payoutVersionSelection } from "../../src/payout-report-scope.ts";
import { pageRequest, periodTotalsRequest } from "../api-fixtures.mjs";

const { publishableKey, admin, members } = JSON.parse(readFileSync(0, "utf8"));
const requests = new Set();
const methods = new Set();
const client = createApiClient(
  { supabaseUrl: "http://127.0.0.1:8000", publishableKey },
  (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const grant = searchParams.get("grant_type");
    requests.add(`${init.method ?? "GET"} ${pathname}${grant ? "?grant_type=" + grant : ""}`);
    return fetch(url, init);
  },
);
// A new public method must complete successfully in at least one real caller's session.
const api = Object.fromEntries(
  Object.entries(client).map(([method, call]) => [
    method,
    async (...args) => {
      const result = await call(...args);
      methods.add(method);
      return result;
    },
  ]),
);
const denied = (action) => assert.rejects(action, (error) => error.status === 403);
const month = "2026-08";
const REVIEW_SCOPE = { marketplace: "Amazon.com", year: 2026 };
const REVIEW_RECORDS = { marketplace: "Amazon.com", month, reason: null, selboxGroup: null };
const dateFrom = month + "-01";
const dateTo = month + "-31";
const scope = (token, id) =>
  api.fetchWorkspaceRevisions({ accessToken: token, userId: id, sources: [] });

async function verifyAuth() {
  const email = `coverage-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const session = await api.signUp(email, password, "http://127.0.0.1:5173/");
  assert.ok(session?.user.id);
  assert.equal(
    (await scope(session.access_token, session.user.id)).account.access_role,
    "unassigned",
  );
  await api.signOut(session.access_token);
  const signedIn = await api.signIn(email, password);
  const fresh = await api.refreshSession(signedIn.refresh_token);
  assert.equal((await api.fetchSessionUser(fresh.access_token)).id, session.user.id);
  const newPassword = randomUUID();
  assert.equal((await api.updatePassword(fresh.access_token, newPassword)).id, session.user.id);
  const changed = await api.signIn(email, newPassword);
  await api.signOut(changed.access_token);
  // The public acknowledgement is also valid for an unknown address, without sending mail.
  await api.requestPasswordRecovery(
    `unused-${randomUUID()}@example.invalid`,
    "http://127.0.0.1:5173/",
  );
}

const RAW_REPORTS = ["ad_invoices", "storage", "aged_storage", "removal_orders"];

async function verifyDatasets(actor, isAdmin) {
  const { token } = actor;
  const pages = {};
  for (const dataset of Object.keys(DATASET_CONFIG)) {
    const search = dataset === "payouts" ? month : dataset === "accounts" ? "@example.invalid" : "";
    const options = pageRequest(dataset, { accessToken: token, search });
    if (!isAdmin && ["finances", "accounts"].includes(dataset)) {
      await denied(api.fetchDatasetPage(options));
      await denied(api.fetchDatasetCount(options));
      continue;
    }
    if (!isAdmin && RAW_REPORTS.includes(dataset)) {
      // The administrator views of Amazon reports give members no rows, not an error.
      const empty = await api.fetchDatasetPage(options);
      assert.deepEqual([empty.rows, empty.totalCount], [[], 0], dataset);
      assert.equal(await api.fetchDatasetCount(options), 0, dataset);
      continue;
    }
    const page = await api.fetchDatasetPage(options);
    assert.ok(page.rows.length, dataset);
    assert.equal(await api.fetchDatasetCount(options), page.totalCount);
    assert.equal(page.rows.length, page.totalCount); // The synthetic dataset fits one page.
    const { idColumns, sortColumns } = DATASET_CONFIG[dataset];
    const identities = (rows) => rows.map((r) => JSON.stringify(idColumns.map((c) => r[c]))).sort();
    for (const column of sortColumns) {
      for (const direction of ["asc", "desc"]) {
        const sorted = await api.fetchDatasetPage({
          ...options,
          sort: { column, direction },
          includeCount: false,
        });
        assert.equal(sorted.totalCount, null);
        assert.deepEqual(identities(sorted.rows), identities(page.rows));
      }
    }
    if (!isAdmin) assert.ok(page.rows.every((row) => row.company_id === actor.company));
    pages[dataset] = page.rows;
  }
  return pages;
}

async function verifyTotals(token) {
  const anchor = await api.fetchLatestTransactionDate({ accessToken: token });
  assert.ok(anchor >= dateFrom && anchor <= dateTo);
  const period = periodTotalsRequest({ accessToken: token, dateFrom, dateTo });
  assert.ok((await api.fetchTransactionPeriodTotals(period)).length);
  assert.ok((await api.fetchTransactionTypeTotals({ ...period, currency: "USD" })).length);
  for (const granularity of ["day", "week"]) {
    assert.ok((await api.fetchTransactionTrends({ ...period, granularity })).length);
  }
}

async function verifyPayout(token, version) {
  const report = { ...version, accessToken: token, pageIndex: 0 };
  assert.ok((await api.fetchPayoutHistory(report)).rows.some((r) => r.id === version.reportId));
  assert.equal((await api.fetchPayoutVersion(report)).id, version.reportId);
  const records = await api.fetchPayoutRecords(token, version.reportId, 0);
  assert.ok(records.rows.length);
  const amounts = await api.fetchPayoutTypeTotals(token, version.reportId, version.currency);
  assert.ok(amounts.length);
  const filtered = await api.fetchPayoutRecords(token, version.reportId, 0, undefined, [
    amounts[0].type,
  ]);
  assert.ok(
    filtered.rows.length && filtered.rows.every((r) => r.component_type === amounts[0].type),
  );
  const readiness = await api.fetchPayoutReadiness(token, month, [version.companyId]);
  assert.deepEqual(
    readiness.rows.map((r) => r.company_id),
    [version.companyId],
  );
}

async function verifyAdminReads(token, rawRows, sku, companyId) {
  assert.ok((await api.fetchSkuOptions(token)).includes(sku));
  for (const row of rawRows) {
    const source = await api.fetchFinancialSourceRecord(token, {
      source: "FINANCES",
      rowId: row.id,
      versionId: row.version_id,
    });
    assert.equal(source?.id, row.id);
  }
  const raw = rawRows[0];
  assert.ok(
    (await api.fetchFinancialSourceTransactions(token, raw.native_transaction_id)).rows.some(
      (r) => r.id === raw.id,
    ),
  );
  await verifyFinancialReview(token);
  await api.fetchPayoutSetupBlockers(token, companyId, month);
}

/** The months' record counts are the exact totals of the matching records pages. */
async function verifyFinancialReview(token) {
  const months = (await api.fetchReviewMonths(token, REVIEW_SCOPE)).filter(
    (row) => row.month === month,
  );
  assert.ok(months.some((row) => row.measure === "FINANCES"));
  for (const outcome of ["DIFFERENCE", "SELBOX"]) {
    const scope = { ...REVIEW_RECORDS, outcome };
    const rows = await api.fetchFinancialOutcomes(token, scope, 0);
    const counts = months.filter((row) => row.measure === outcome);
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    assert.equal(rows.length, Math.min(total, 50));
    const [first] = counts;
    if (!first) continue;
    const narrowed = await api.fetchFinancialOutcomes(
      token,
      { ...scope, reason: first.reason, selboxGroup: first.selboxGroup },
      0,
    );
    assert.equal(narrowed.length, Math.min(first.count, 50));
  }
}

async function verifyReadWorkspace(actor, isAdmin) {
  const { token, userId } = actor;
  const { account } = await api.fetchWorkspaceRevisions({
    accessToken: token,
    userId,
    sources: ["finances", "references", "fees", "payouts", "inventory"],
  });
  assert.equal(account.access_role, isAdmin ? "administrator" : "member");
  const companies = await api.fetchCompanies(token);
  const skus = await api.fetchSkuAssignments(token);
  const inventory = await api.fetchInventoryRows(token, account);
  assert.ok((await api.fetchInventoryCaptures(token)).length);
  assert.ok(companies.length && skus.length && inventory.length);
  if (!isAdmin) {
    assert.equal(companies.length, 1);
    assert.ok(inventory.every((r) => r.company_id === actor.company));
  }
  const fees = await api.fetchSkuConfiguration(token);
  const owned = fees.items.find((item) => item.sku_id && item.periods.length);
  assert.ok(owned);
  const history = await api.fetchSkuConfigurationHistory(token, owned.sku_id);
  assert.ok(history.versions.some((version) => version.periods.length));

  const pages = await verifyDatasets(actor, isAdmin);
  await verifyTotals(token);
  const version = payoutVersionSelection(pages.payouts[0]);
  await verifyPayout(token, version);
  if (!isAdmin) {
    await denied(api.fetchSkuOptions(token));
    await denied(
      api.fetchFinancialOutcomes(token, { ...REVIEW_RECORDS, outcome: "DIFFERENCE" }, 0),
    );
    await denied(api.fetchReviewMonths(token, REVIEW_SCOPE));
    // Members read only their own company's current assignments.
    const own = await api.fetchReferenceAssignments(token, "member");
    assert.ok(own.every((row) => row.companyId === actor.company && row.warning === null));
    await denied(api.fetchPayoutSetupBlockers(token, version.companyId, month));
    await denied(api.fetchPayoutRecords(token, actor.foreignReport, 0));
    return;
  }
  await verifyAdminReads(token, pages.finances, owned.sku, version.companyId);
  await verifyInvoiceLines(pages.ad_invoices[0]);
  verifyStorageFigures(pages.storage[0]);
}

/** The fixture's North American storage row keeps Amazon's figures in the two-rate form. */
function verifyStorageFigures(row) {
  const figures = {
    average_quantity_on_hand: "2.5",
    estimated_total_item_volume: "0.96",
    base_rate: "0.78",
    utilization_surcharge_rate: "0",
    est_vol_for_sus: "0",
    est_base_msf: "0.75",
    est_sus: "0",
  };
  for (const [column, value] of Object.entries(figures))
    assert.equal(compareDecimals(row[column], value), 0, column);
  assert.equal(row.storage_rate, null);
  assert.equal(row.storage_utilization_ratio, "9.2");
  assert.equal(row.product_size_tier, "Standard-Size");
  assert.equal(row.volume_units, "cubic feet");
}

/** An invoice's lines are read by its version; members get none of them. */
async function verifyInvoiceLines(invoice) {
  const request = { versionId: invoice.version_id, lineCount: Number(invoice.line_count) };
  const lines = await api.fetchAdInvoiceLines(admin.token, request);
  assert.ok(lines.length && lines.every((line) => line.currency === invoice.currency));
  for (const member of members)
    assert.deepEqual(await api.fetchAdInvoiceLines(member.token, { ...request, lineCount: 0 }), []);
}

async function verifyEdits() {
  const member = members[0];
  const created = await api.createCompany(admin.token, "Temporary client coverage");
  assert.ok(created.created);
  const original = (await scope(member.token, member.userId)).account;
  await denied(api.createCompany(member.token, "Member cannot create"));
  await denied(api.deleteCompany(member.token, created.id));
  await denied(
    api.setCompanyMembership({
      accessToken: member.token,
      account: original,
      companyId: created.id,
    }),
  );
  const moved = await api.setCompanyMembership({
    accessToken: admin.token,
    account: original,
    companyId: created.id,
  });
  assert.equal((await scope(member.token, member.userId)).account.company_id, created.id);
  await api.setCompanyMembership({
    accessToken: admin.token,
    account: moved,
    companyId: original.company_id,
  });
  assert.ok((await api.deleteCompany(admin.token, created.id)).deleted);
  const changes = [
    {
      sku: "COVERAGE-NEW",
      company_id: member.company,
      expected_current_version_id: null,
      periods: [],
    },
  ];
  await denied(api.publishSkuConfiguration({ accessToken: member.token, changes }));
  assert.equal(
    (await api.publishSkuConfiguration({ accessToken: admin.token, changes })).changed_count,
    1,
  );
  await verifyAssignmentEdits(member, members[1]);
}

/** An administrator assigns the seeded promotion to one member's company; only that member reads it. */
async function verifyAssignmentEdits(member, other) {
  const coupon = (await api.fetchReferenceAssignments(admin.token, "administrator")).find(
    (row) => row.kind === "PROMOTION" && row.nativeKey === "coupon",
  );
  assert.ok(coupon, "the seeded promotion");
  assert.equal(coupon.companyId, null);
  assert.equal(coupon.warning, "NO_ASSIGNMENT");
  // Amazon's promotion record names its marketplace; no Finances charge names the promotion.
  assert.deepEqual(coupon.marketplaceNames, ["Amazon.com"]);
  const sameId = (row) => assignmentKey(row) === assignmentKey(coupon);
  const readBy = async (actor) => {
    const reader = actor === admin ? "administrator" : "member";
    return (await api.fetchReferenceAssignments(actor.token, reader)).find(sameId);
  };
  const change = (row, companyId, memo) => ({ companyId, memo, expectedVersionId: row.versionId });
  await denied(
    api.setReferenceAssignment(member.token, coupon, change(coupon, member.company, "Denied")),
  );
  assert.equal(await readBy(member), undefined);
  const versionId = await api.setReferenceAssignment(
    admin.token,
    coupon,
    change(coupon, member.company, "Synthetic assignment"),
  );
  const visible = await readBy(member);
  assert.ok(visible);
  assert.equal(visible.companyId, member.company);
  assert.equal(visible.versionId, versionId);
  assert.deepEqual(visible.marketplaceNames, ["Amazon.com"]);
  // Review fields reveal other companies' SKU ownership and never reach members.
  assert.deepEqual(
    [visible.origin, visible.warning, visible.suggestedCompanyId, visible.products],
    [null, null, null, []],
  );
  assert.equal(await readBy(other), undefined);
  const assigned = await readBy(admin);
  assert.equal(assigned.origin, "ADMINISTRATOR");
  // A save that names an older version is refused, not applied over the newer one.
  await assert.rejects(
    api.setReferenceAssignment(admin.token, assigned, change(coupon, null, "Stale")),
    (error) => error.status === 409,
  );
  const cleared = await api.setReferenceAssignment(
    admin.token,
    assigned,
    change(assigned, null, ""),
  );
  assert.equal(await readBy(member), undefined);
  const history = await api.fetchAssignmentHistory(admin.token, assigned.keyId, cleared);
  assert.deepEqual(
    history.slice(0, 2).map((version) => [version.companyId, version.memo]),
    [
      [null, DEFAULT_ASSIGNMENT_MEMO],
      [member.company, "Synthetic assignment"],
    ],
  );
}

await verifyAuth();
await verifyReadWorkspace(admin, true);
for (const member of members) await verifyReadWorkspace(member, false);
await verifyEdits();
assert.deepEqual([...methods].sort(), Object.keys(client).sort());
// Pin the wire contract independently of client composition. A method can still return
// successfully if a lookup, separate HEAD count or second phase of a paged read disappears.
const endpoints = {
  "POST /auth/v1/": [
    "signup",
    "token?grant_type=password",
    "token?grant_type=refresh_token",
    "recover",
    "logout",
  ],
  "GET /auth/v1/": ["user"],
  "PUT /auth/v1/": ["user"],
  "GET /rest/v1/": [
    "companies",
    "company_skus",
    "latest_inventory_captures",
    "latest_inventory_items",
    "latest_company_payout_reports",
    "company_payout_reports",
    "assignment_versions",
    "rpc/workspace_revisions",
    "rpc/account_directory",
    "rpc/payout_readiness",
    "rpc/payout_setup_blockers",
    "rpc/financial_outcome_page",
    "rpc/financial_review_months",
    "current_ad_invoices",
    "current_ad_invoice_lines",
    "current_storage_rows",
    "current_aged_storage_rows",
    "current_removal_order_rows",
  ],
  "HEAD /rest/v1/": [
    "latest_company_payout_reports",
    "rpc/account_directory",
    "current_ad_invoices",
    "current_storage_rows",
    "current_aged_storage_rows",
    "current_removal_order_rows",
  ],
  "POST /rest/v1/rpc/": [
    "sku_filter_options",
    "sku_configuration",
    "sku_configuration_history",
    "publish_sku_configuration",
    "create_company",
    "delete_company",
    "set_company_membership",
    "reference_assignments",
    "set_reference_assignment",
    "financial_source_record",
    "financial_source_transaction_lookup",
    "transaction_page",
    "transaction_count",
    "source_transaction_page",
    "source_transaction_count",
    "transaction_totals",
    "payout_report_records",
    "payout_report_totals",
    "payout_search_months",
  ],
};
assert.deepEqual(
  [...requests].sort(),
  Object.entries(endpoints)
    .flatMap(([prefix, names]) => names.map((name) => prefix + name))
    .sort(),
);
stdout.write(
  `${methods.size} frontend methods verified over ${requests.size} HTTP method/route combinations.\n`,
);
