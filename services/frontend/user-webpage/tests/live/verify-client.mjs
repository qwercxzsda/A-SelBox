// Exercise the real frontend client against the synthetic stack owned by test_frontend_client.py.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { stdout } from "node:process";
import { createApiClient } from "../../src/api/client.ts";
import { DATASET_CONFIG } from "../../src/api/config.ts";
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
  for (const outcome of ["COMPANY", "DIFFERENCE", "SELBOX"]) {
    const results = await api.fetchFinancialOutcomes(
      token,
      { outcome, month, marketplace: "Amazon.com" },
      0,
    );
    assert.ok(results.rows.every((r) => r.outcome === outcome));
    if (outcome === "COMPANY") assert.ok(results.rows.length);
  }
  assert.ok((await api.fetchOutcomeMonths(token, month, "Amazon.com", 0)).rows.length);
  await api.fetchPayoutSetupBlockers(token, companyId, month);
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
      api.fetchFinancialOutcomes(token, { outcome: "COMPANY", month, marketplace: "" }, 0),
    );
    await denied(api.fetchOutcomeMonths(token, month, "", 0));
    assert.deepEqual(
      (await api.fetchAssignmentStatus(token, { kind: "", warningsOnly: false }, 0)).rows,
      [],
    );
    await denied(api.fetchPayoutSetupBlockers(token, version.companyId, month));
    await denied(api.fetchPayoutRecords(token, actor.foreignReport, 0));
    return;
  }
  await verifyAdminReads(token, pages.finances, owned.sku, version.companyId);
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
  const blank = (
    await api.fetchAssignmentStatus(admin.token, { kind: "PROMOTION", warningsOnly: true }, 0)
  ).rows[0];
  assert.equal(blank.kind, "PROMOTION");
  await denied(api.setReferenceAssignment(member.token, blank, member.company, "Member denied"));
  await api.setReferenceAssignment(admin.token, blank, member.company, "Synthetic assignment");
  const assigned = (
    await api.fetchAssignmentStatus(admin.token, { kind: "PROMOTION", warningsOnly: false }, 0)
  ).rows[0];
  assert.equal(assigned.companyId, member.company);
  await api.setReferenceAssignment(admin.token, assigned, null, "Synthetic clearance");
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
    "assignment_status",
    "rpc/workspace_revisions",
    "rpc/account_directory",
    "rpc/payout_readiness",
    "rpc/payout_setup_blockers",
    "rpc/financial_outcome_page",
    "rpc/financial_review_month_page",
  ],
  "HEAD /rest/v1/": ["latest_company_payout_reports", "rpc/account_directory"],
  "POST /rest/v1/rpc/": [
    "sku_filter_options",
    "sku_configuration",
    "sku_configuration_history",
    "publish_sku_configuration",
    "create_company",
    "delete_company",
    "set_company_membership",
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
