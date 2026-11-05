import assert from "node:assert/strict";
import test from "node:test";
import { workspaceLocation, locationPreference } from "../src/workspace-location.ts";
import { createDatasetViewState, createInventoryViewState } from "../src/workspace-view-state.ts";
import { reviewPeriodKey } from "../src/financial-review-scope-key.ts";

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
    marketplaceName: "Amazon.com",
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

test("saved report links require marketplace metadata and preserve an explicit unspecified market", () => {
  for (const [marketplaceName, currency] of [
    ["Amazon.de", "EUR"],
    ["Non-Amazon IT", "EUR"],
    [null, null],
  ]) {
    const selected = {
      reportId,
      companyId,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      currency,
      marketplaceName,
    };
    const preferences = new Map([
      ["tab", "payouts"],
      ["datasets", { payouts: { ...createDatasetViewState("payouts"), selectedRowId: reportId } }],
      ["payout-report-history", { selected }],
    ]);
    const url = workspaceLocation(origin, admin, preferences);
    assert.equal(url.searchParams.get("reportMarketplace"), marketplaceName ?? "");
    assert.deepEqual(
      locationPreference(url, admin, "payout-report-history", {}).selected,
      selected,
    );
    for (const required of [
      "report",
      "reportCompany",
      "reportFrom",
      "reportTo",
      "reportCurrency",
      "reportMarketplace",
    ]) {
      const incomplete = new URL(url);
      incomplete.searchParams.delete(required);
      assert.equal(
        locationPreference(incomplete, admin, "payout-report-history", {}).selected,
        null,
        required,
      );
      assert.equal(
        locationPreference(incomplete, admin, "datasets", {}).payouts.selectedRowId,
        null,
        required,
      );
    }
    url.searchParams.delete("reportMarketplace");
    assert.equal(locationPreference(url, admin, "payout-report-history", {}).selected, null);
    assert.equal(locationPreference(url, admin, "datasets", {}).payouts.selectedRowId, null);
    url.searchParams.set("tab", "financial-review");
    assert.equal(locationPreference(url, admin, "tab", "payouts"), "financial-review");
  }
});

test("payout marketplace filters round trip independently of report identity", () => {
  const view = createDatasetViewState("payouts");
  view.filters.marketplaces = ["Amazon.de", "Amazon.fr"];
  const url = workspaceLocation(
    origin,
    admin,
    new Map([
      ["tab", "payouts"],
      ["datasets", { payouts: view }],
    ]),
  );
  assert.deepEqual(url.searchParams.getAll("marketplace"), view.filters.marketplaces);
  assert.deepEqual(
    locationPreference(url, admin, "datasets", {}).payouts.filters.marketplaces,
    view.filters.marketplaces,
  );
});

test("review URLs preserve marketplace separately from currency and month", () => {
  const prefs = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "DATA_KIOSK"],
    ["financial-review:scope", { year: "2026", marketplace: "Amazon.co.jp", currency: "JPY" }],
    ["financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: "2026-07" }],
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.deepEqual(locationPreference(url, admin, "financial-review:scope", {}), {
    year: "2026",
    marketplace: "Amazon.co.jp",
    currency: "JPY",
    families: [],
  });
  assert.equal(url.searchParams.get("reviewMarketplace"), "Amazon.co.jp");
  assert.equal(url.searchParams.has("marketplace"), false);
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

test("review family URLs preserve multiple families and clear them on unfiltered navigation", () => {
  const prefs = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "DATA_KIOSK"],
    [
      "financial-review:scope",
      {
        year: "2026",
        marketplace: "Amazon.com",
        currency: "USD",
        families: ["sponsored-products", "monthly-storage"],
      },
    ],
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.deepEqual(url.searchParams.getAll("family"), ["monthly-storage", "sponsored-products"]);
  assert.deepEqual(locationPreference(url, admin, "financial-review:scope", {}), {
    year: "2026",
    marketplace: "Amazon.com",
    currency: "USD",
    families: ["monthly-storage", "sponsored-products"],
  });
  url.searchParams.delete("family");
  assert.deepEqual(
    locationPreference(url, admin, "financial-review:scope", { families: ["monthly-storage"] })
      .families,
    [],
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

test("bare URLs keep local state, and malformed report/month identifiers are ignored", () => {
  const saved = { editing: { form: { fee_rate_percent: "4.8" } } };
  assert.equal(locationPreference(origin, admin, "fees", saved), saved);
  const url = new URL("https://example.test/?tab=payouts&report=invalid&reportFrom=2026-02-30");
  assert.equal(locationPreference(url, admin, "payout-report-history", {}).selected, null);
});

test("nested report links survive pending month queries within their marketplace currency and month", () => {
  const selected = {
    reportId,
    companyId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    currency: "USD",
    marketplaceName: "Amazon.com",
  };
  const prefs = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "DATA_KIOSK"],
    ["financial-review:scope", { year: "2026", marketplace: "Amazon.com", currency: "USD" }],
    ["financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: "2026-07" }],
  ]);
  const incoming = new URL(origin);
  for (const [key, value] of Object.entries({
    tab: "financial-review",
    category: "DATA_KIOSK",
    year: "2026",
    currency: "USD",
    reviewMarketplace: "Amazon.com",
    month: "2026-07",
    report: reportId,
    reportCompany: companyId,
    reportFrom: selected.startDate,
    reportTo: selected.endDate,
    reportCurrency: "USD",
    reportMarketplace: "Amazon.com",
  }))
    incoming.searchParams.set(key, value);
  const waiting = workspaceLocation(incoming, admin, prefs);
  const key = reviewPeriodKey("2026-07", "Amazon.com", "USD");
  assert.equal(waiting.searchParams.get("report"), reportId);
  assert.equal(
    locationPreference(waiting, admin, `financial-review:snapshots:${key}`, {}).selectedRowId,
    reportId,
  );
  const mismatch = new URL(waiting);
  mismatch.searchParams.set("reportCurrency", "JPY");
  assert.equal(
    locationPreference(mismatch, admin, `financial-review:snapshots:${key}`, {}).selectedRowId,
    null,
  );
  mismatch.searchParams.set("reportCurrency", "USD");
  mismatch.searchParams.set("reportMarketplace", "Non-Amazon US");
  assert.equal(
    locationPreference(mismatch, admin, `financial-review:snapshots:${key}`, {}).selectedRowId,
    null,
  );
  assert.equal(workspaceLocation(mismatch, admin, prefs).searchParams.has("report"), false);
  prefs.set(`financial-review:snapshots:${key}`, { selectedRowId: null });
  assert.equal(workspaceLocation(waiting, admin, prefs).searchParams.has("report"), false);
});

test("currency-only review links use the default marketplace without inferring a country", () => {
  const old = new URL("https://example.test/?tab=financial-review&year=2026&currency=EUR");
  const scope = locationPreference(old, admin, "financial-review:scope", {});
  assert.deepEqual(scope, { year: "2026", marketplace: "Amazon.com", currency: "", families: [] });
  const url = workspaceLocation(
    old,
    admin,
    new Map([
      ["tab", "financial-review"],
      ["financial-review:scope", scope],
    ]),
  );
  assert.equal(url.searchParams.get("reviewMarketplace"), "Amazon.com");
  assert.equal(url.searchParams.has("currency"), false);
});

test("review snapshot history is isolated between markets sharing one currency", () => {
  const period = reviewPeriodKey("2026-07", "Amazon.de", "EUR");
  const selected = {
    reportId,
    companyId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    currency: "EUR",
    marketplaceName: "Amazon.de",
  };
  const preferences = new Map([
    ["tab", "financial-review"],
    ["financial-review:category", "FINANCES"],
    ["financial-review:scope", { year: "2026", marketplace: "Amazon.de", currency: "EUR" }],
    ["financial-review:monthly-summaries:FINANCES", { selectedMonth: "2026-07" }],
    [`financial-review:snapshots:${period}`, { selectedRowId: reportId }],
    [`payout-review-history:${period}`, { selected }],
  ]);
  const url = workspaceLocation(origin, admin, preferences);
  assert.equal(url.searchParams.get("report"), reportId);
  preferences.set("financial-review:scope", {
    year: "2026",
    marketplace: "Amazon.fr",
    currency: "EUR",
  });
  const otherMarket = workspaceLocation(url, admin, preferences);
  assert.equal(otherMarket.searchParams.has("report"), false);
  assert.notEqual(
    reviewPeriodKey("2026-07", "Amazon.de", "EUR"),
    reviewPeriodKey("2026-07", "Amazon.fr", "EUR"),
  );
});

test("automatic review units restore a report after the mounted period resolves its currency", () => {
  const url = new URL(
    "https://example.test/?tab=financial-review&reviewMarketplace=Amazon.de&month=2026-07",
  );
  for (const [key, value] of Object.entries({
    report: reportId,
    reportCompany: companyId,
    reportFrom: "2026-07-01",
    reportTo: "2026-07-31",
    reportCurrency: "EUR",
    reportMarketplace: "Amazon.de",
  }))
    url.searchParams.set(key, value);
  const period = reviewPeriodKey("2026-07", "Amazon.de", "EUR");
  assert.equal(
    locationPreference(url, admin, `financial-review:snapshots:${period}`, {}).selectedRowId,
    reportId,
  );
  assert.equal(
    locationPreference(url, admin, `payout-review-history:${period}`, {}).selected.reportId,
    reportId,
  );
  const otherUnit = reviewPeriodKey("2026-07", "Amazon.de", "USD");
  assert.equal(
    locationPreference(url, admin, `financial-review:snapshots:${otherUnit}`, {}).selectedRowId,
    null,
  );
});

test("opening an automatic-unit month writes its actual period and report in one navigation state", () => {
  const scope = { year: "2026", marketplace: "Amazon.de", currency: "", families: [] };
  const period = reviewPeriodKey("2026-07", "Amazon.de", "EUR");
  const selected = {
    reportId,
    companyId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    currency: "EUR",
    marketplaceName: "Amazon.de",
  };
  const preferences = new Map([
    ["tab", "financial-review"],
    ["financial-review:scope", scope],
    ["financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: null }],
  ]);
  const overview = workspaceLocation(origin, admin, preferences);
  assert.equal(overview.searchParams.has("currency"), false);
  preferences.set("financial-review:monthly-summaries:DATA_KIOSK", {
    selectedMonth: "2026-07",
    currency: "EUR",
  });
  const month = workspaceLocation(overview, admin, preferences);
  assert.equal(month.searchParams.get("reviewMarketplace"), "Amazon.de");
  assert.equal(month.searchParams.get("month"), "2026-07");
  assert.equal(month.searchParams.get("currency"), "EUR");
  assert.equal(scope.currency, "");
  preferences.set(`financial-review:snapshots:${period}`, { selectedRowId: reportId });
  preferences.set(`payout-review-history:${period}`, { selected });
  const report = workspaceLocation(month, admin, preferences);
  assert.equal(report.searchParams.get("report"), reportId);
  assert.equal(report.searchParams.get("reportMarketplace"), "Amazon.de");
  assert.equal(report.searchParams.get("currency"), "EUR");
  preferences.set(`financial-review:snapshots:${period}`, { selectedRowId: null });
  assert.equal(workspaceLocation(report, admin, preferences).searchParams.has("report"), false);
  preferences.set("financial-review:monthly-summaries:DATA_KIOSK", { selectedMonth: null });
  const closed = workspaceLocation(report, admin, preferences);
  assert.equal(closed.href, overview.href);
});
