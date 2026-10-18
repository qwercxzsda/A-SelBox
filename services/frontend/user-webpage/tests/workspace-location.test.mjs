import assert from "node:assert/strict";
import test from "node:test";
import { workspaceLocation, locationPreference } from "../src/workspace-location.ts";
import { createDatasetViewState, createInventoryViewState } from "../src/workspace-view-state.ts";

const admin = { user_id: "reviewer", access_role: "administrator", company_id: null };
const companyId = "10000000-0000-0000-0000-000000000001";
const reportId = "20000000-0000-0000-0000-000000000001";
const origin = new URL("https://example.test/");

test("read-only transaction navigation round trips without losing reload filters or paging", () => {
  const view = createDatasetViewState("live");
  view.search = "sale";
  view.pagination = { pageIndex: 3, pageSize: 100 };
  view.sorting = [{ id: "source_amount", desc: false }];
  view.filters = {
    ...view.filters,
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    companyIds: [companyId],
    skus: ['a,b " SKU'],
    marketplaces: ["Amazon.com"],
    types: ["PRODUCT_SALES"],
    sources: ["FINANCES"],
    feeApplicability: ["applicable"],
  };
  const prefs = new Map([
    ["tab", "live"],
    ["datasets", { live: view }],
    ["summary-currency", "JPY"],
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.deepEqual(locationPreference(url, admin, "datasets", {}), { live: view });
  assert.equal(locationPreference(url, admin, "summary-currency", null), "JPY");
});

test("report links retain exact historical identity while drafts and amounts stay out of the URL", () => {
  const selected = {
    reportId,
    companyId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    currency: "USD",
  };
  const view = { ...createDatasetViewState("payouts"), selectedRowId: reportId };
  const prefs = new Map([
    ["tab", "payouts"],
    ["datasets", { payouts: view }],
    ["payout-report-history", { selected }],
    ["fees", { drafts: [{ fee_rate_percent: "secret-draft" }] }],
    ["session", { access_token: "secret-token" }],
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.equal(url.href.includes("secret"), false);
  assert.deepEqual(locationPreference(url, admin, "payout-report-history", {}).selected, selected);
  assert.equal(locationPreference(url, admin, "datasets", {}).payouts.selectedRowId, reportId);
});

test("review URLs preserve category year currency and month, and absence closes the old drawer", () => {
  const prefs = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "DATA_KIOSK"],
    ["financial-review:scope", { year: "2026", currency: "JPY" }],
    ["financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: "2026-07" }],
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.deepEqual(locationPreference(url, admin, "financial-review:scope", {}), {
    year: "2026",
    currency: "JPY",
  });
  assert.deepEqual(
    locationPreference(url, admin, "financial-review:monthly-summaries:DATA_KIOSK", {}),
    { selectedMonth: "2026-07" },
  );
  url.searchParams.delete("month");
  assert.deepEqual(
    locationPreference(url, admin, "financial-review:monthly-summaries:DATA_KIOSK", {
      selectedMonth: "2026-07",
    }),
    { selectedMonth: null },
  );
});

test("member links cannot select administrator tabs or promote account permissions", () => {
  const member = { ...admin, access_role: "member", company_id: companyId };
  const url = new URL("https://example.test/?tab=financial-review&role=administrator");
  assert.equal(locationPreference(url, member, "tab", "inventory"), "live");
  assert.equal(member.access_role, "member");
});

test("inventory navigation preserves unknown filter choices and exact SKU identities", () => {
  const view = {
    ...createInventoryViewState(),
    marketplace: "Amazon.com",
    skus: ["null"],
    healthStatuses: [null, "Out of stock"],
    recommendations: ["Edit listing"],
    selectedRowId: "capture:SKU",
  };
  const url = workspaceLocation(
    origin,
    admin,
    new Map([
      ["tab", "inventory"],
      ["inventory", view],
    ]),
  );
  assert.deepEqual(locationPreference(url, admin, "inventory", null), view);
});

test("legacy bare URLs keep local state, and malformed report/month identifiers are ignored", () => {
  const saved = { editing: { form: { fee_rate_percent: "4.8" } } };
  assert.equal(locationPreference(origin, admin, "fees", saved), saved);
  const url = new URL("https://example.test/?tab=payouts&report=invalid&reportFrom=2026-02-30");
  assert.equal(locationPreference(url, admin, "payout-report-history", {}).selected, null);
});

test("nested report links survive pending month queries and stay within review currency and month", () => {
  const selected = {
    reportId,
    companyId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    currency: "USD",
  };
  const prefs = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "DATA_KIOSK"],
    ["financial-review:scope", { year: "2026", currency: "USD" }],
    ["financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: "2026-07" }],
  ]);
  const incoming = new URL(origin);
  for (const [key, value] of Object.entries({
    tab: "financial-review",
    category: "DATA_KIOSK",
    year: "2026",
    currency: "USD",
    month: "2026-07",
    report: reportId,
    reportCompany: companyId,
    reportFrom: selected.startDate,
    reportTo: selected.endDate,
    reportCurrency: "USD",
  }))
    incoming.searchParams.set(key, value);
  const waiting = workspaceLocation(incoming, admin, prefs);
  assert.equal(waiting.searchParams.get("report"), reportId);
  assert.equal(
    locationPreference(waiting, admin, "financial-review:snapshots:2026-07:USD", {}).selectedRowId,
    reportId,
  );
  const mismatch = new URL(waiting);
  mismatch.searchParams.set("reportCurrency", "JPY");
  assert.equal(
    locationPreference(mismatch, admin, "financial-review:snapshots:2026-07:USD", {}).selectedRowId,
    null,
  );
  prefs.set("financial-review:snapshots:2026-07:USD", { selectedRowId: null });
  assert.equal(workspaceLocation(waiting, admin, prefs).searchParams.has("report"), false);
});
