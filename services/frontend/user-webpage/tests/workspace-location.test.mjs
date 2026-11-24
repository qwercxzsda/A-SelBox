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
