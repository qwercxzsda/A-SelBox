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
  ]);
  const url = workspaceLocation(origin, admin, prefs);
  assert.deepEqual(locationPreference(url, admin, "datasets", {}), { live: view });
  assert.equal(url.searchParams.has("currency"), false);
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

test("member links cannot select administrator tabs or promote account permissions", () => {
  const member = { ...admin, access_role: "member", company_id: companyId };
  const url = new URL("https://example.test/?tab=financial-review&role=administrator");
  assert.equal(locationPreference(url, member, "tab", "inventory"), "live");
  assert.equal(member.access_role, "member");
});

test("inventory navigation preserves marketplace and company selections and exact SKU identities", () => {
  const view = {
    ...createInventoryViewState(),
    marketplaces: ["Amazon.com", "Amazon.ca"],
    companyIds: [companyId, null],
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
  assert.deepEqual(url.searchParams.getAll("marketplace"), view.marketplaces);
  assert.deepEqual(url.searchParams.getAll("company"), [JSON.stringify(companyId), "null"]);
  assert.deepEqual(locationPreference(url, admin, "inventory", null), view);
});

test("inventory company links reject malformed identifiers and never apply to member navigation", () => {
  const url = new URL("https://example.test/?tab=inventory&marketplace=Amazon.com");
  for (const value of [JSON.stringify(companyId), "null", '"invalid"', "42", "{", "{}"])
    url.searchParams.append("company", value);
  const view = locationPreference(url, admin, "inventory", null);
  assert.deepEqual(view.companyIds, [companyId, null]);
  const member = { ...admin, access_role: "member", company_id: companyId };
  assert.deepEqual(locationPreference(url, member, "inventory", null), {
    ...view,
    companyIds: [],
  });
  const memberUrl = workspaceLocation(
    url,
    member,
    new Map([
      ["tab", "inventory"],
      ["inventory", view],
    ]),
  );
  assert.equal(memberUrl.searchParams.has("company"), false);
  assert.deepEqual(memberUrl.searchParams.getAll("marketplace"), ["Amazon.com"]);
});

test("bare URLs keep local state, and malformed report/month identifiers are ignored", () => {
  const saved = { editing: { form: { fee_rate_percent: "4.8" } } };
  assert.equal(locationPreference(origin, admin, "fees", saved), saved);
  const url = new URL("https://example.test/?tab=payouts&report=invalid&reportFrom=2026-02-30");
  assert.equal(locationPreference(url, admin, "payout-report-history", {}).selected, null);
});

test("Current fees and Companies put only the open row in the URL", () => {
  const drafts = [{ sku: "S1", fee_rate_percent: "secret-draft" }];
  const fees = new Map([
    ["tab", "fees"],
    ["fees", { selectedSku: 'a,b " SKU', drafts }],
  ]);
  const feeUrl = workspaceLocation(origin, admin, fees);
  assert.equal(feeUrl.searchParams.get("row"), 'a,b " SKU');
  assert.equal(feeUrl.href.includes("secret"), false);
  const restoredFees = locationPreference(feeUrl, admin, "fees", { selectedSku: "S2", drafts });
  assert.equal(restoredFees.selectedSku, 'a,b " SKU');
  assert.deepEqual(restoredFees.drafts, drafts);
  const closedFees = new URL("https://example.test/?tab=fees");
  assert.equal(
    locationPreference(closedFees, admin, "fees", { selectedSku: "S2" }).selectedSku,
    null,
  );
  assert.equal(workspaceLocation(closedFees, admin, new Map()).searchParams.has("row"), false);

  const companies = new Map([
    ["tab", "companies"],
    ["companies:list", { search: "north", selected: companyId }],
  ]);
  const companyUrl = workspaceLocation(origin, admin, companies);
  assert.equal(companyUrl.searchParams.get("row"), companyId);
  assert.equal(companyUrl.searchParams.has("search"), false);
  assert.deepEqual(locationPreference(companyUrl, admin, "companies:list", { search: "north" }), {
    search: "north",
    selected: companyId,
  });
  assert.equal(
    workspaceLocation(companyUrl, admin, new Map([["tab", "companies"]])).searchParams.get("row"),
    companyId,
  );
  assert.equal(
    locationPreference(companyUrl, admin, "fees", { selectedSku: "S2" }).selectedSku,
    "S2",
  );
});

test("Raw data keeps its sub-tab in raw= and each sub-tab's own list, row included", () => {
  const storage = createDatasetViewState("storage");
  storage.search = "X000";
  storage.pagination = { pageIndex: 2, pageSize: 50 };
  storage.filters = {
    ...storage.filters,
    marketplaces: ["Amazon.de"],
    dateFrom: "2026-07-01",
    dateTo: "2026-07-01",
  };
  storage.selectedRowId = "storage-row";
  const finances = { ...createDatasetViewState("finances"), search: "finances-only" };
  const url = workspaceLocation(
    origin,
    admin,
    new Map([
      ["tab", "raw-data"],
      ["raw-data:dataset", "storage"],
      ["datasets", { storage, finances }],
    ]),
  );
  assert.equal(url.searchParams.get("tab"), "raw-data");
  assert.equal(url.searchParams.get("raw"), "storage");
  assert.equal(url.searchParams.get("row"), "storage-row");
  assert.equal(url.searchParams.get("search"), "X000");
  assert.equal(locationPreference(url, admin, "raw-data:dataset", "finances"), "storage");
  // The URL restores the open sub-tab only; other sub-tabs keep their saved state.
  assert.deepEqual(locationPreference(url, admin, "datasets", { finances }), { finances, storage });
  assert.equal(locationPreference(url, admin, "tab", "live"), "raw-data");

  const unknown = new URL("https://example.test/?tab=raw-data&raw=payouts");
  assert.equal(locationPreference(unknown, admin, "raw-data:dataset", "storage"), "finances");
  assert.equal(
    workspaceLocation(unknown, admin, new Map([["tab", "raw-data"]])).searchParams.get("raw"),
    "finances",
  );
  // Leaving Raw data drops its sub-tab from the URL.
  assert.equal(
    workspaceLocation(url, admin, new Map([["tab", "live"]])).searchParams.has("raw"),
    false,
  );
});

test("members cannot open Raw data, or its former Finances tab, through a URL", () => {
  const member = { ...admin, access_role: "member", company_id: companyId };
  for (const tab of ["raw-data", "finances", "storage"]) {
    const url = new URL(`https://example.test/?tab=${tab}&raw=storage&row=storage-row`);
    assert.equal(locationPreference(url, member, "tab", "inventory"), "live");
    assert.equal(locationPreference(url, member, "raw-data:dataset", "finances"), "finances");
    assert.equal(locationPreference(url, admin, "tab", "live"), tab === "raw-data" ? tab : "live");
  }
});
