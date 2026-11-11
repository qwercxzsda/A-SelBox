import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { createDatasetScope } from "../src/dataset-query-cache.ts";
import {
  SETTINGS,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  responseJson,
  pageRequest,
  datasetFilters,
} from "./api-fixtures.mjs";

test("payout list and count share company and monthly filters", async () => {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("company_id"), `in.(${COMPANY_ID})`);
    assert.deepEqual(params.getAll("start_date"), ["gte.2026-06-01", "lte.2026-06-01"]);
    if (init.method !== "HEAD")
      assert.equal(
        params.get("order"),
        "start_date.desc.nullslast,company_id.asc,marketplace_name.asc.nullslast,currency.asc,id.asc",
      );
    calls.push(init.method ?? "GET");
    return new Response("id\n", { headers: { "Content-Range": "*/0" } });
  });
  const options = pageRequest("payouts", {
    filters: datasetFilters({
      companyIds: [COMPANY_ID],
      dateFrom: "2026-06-01",
      dateTo: "2026-06-01",
    }),
  });
  assert.equal((await client.fetchDatasetPage(options)).rows.length, 0);
  assert.equal(await client.fetchDatasetCount(options), 0);
  assert.deepEqual(calls, ["GET", "HEAD"]);
});

test("payout pages and counts list only the latest version of each report", async () => {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    calls.push([new URL(url).pathname, init.method ?? "GET"]);
    return new Response("id\n", { headers: { "Content-Range": "*/0" } });
  });
  const options = pageRequest("payouts", { filters: datasetFilters() });
  await client.fetchDatasetPage(options);
  await client.fetchDatasetCount(options);
  assert.deepEqual(calls, [
    ["/rest/v1/latest_company_payout_reports", "GET"],
    ["/rest/v1/latest_company_payout_reports", "HEAD"],
  ]);
});

test("payout cache does not reuse another marketplace or amount unit", () => {
  const identity = {
    session: { user: { id: "member" } },
    account: { access_role: "member", company_id: COMPANY_ID },
    skuOptions: [],
  };
  const options = {
    dataset: "payouts",
    search: "",
    currency: "EUR",
    filters: datasetFilters({ marketplaces: ["Amazon.de"] }),
  };
  const base = createDatasetScope(identity, options);
  for (const patch of [
    { currency: "USD" },
    { filters: datasetFilters({ marketplaces: ["Amazon.fr"] }) },
  ]) {
    const other = createDatasetScope(identity, { ...options, ...patch });
    assert.notDeepEqual(other.key, base.key);
    assert.notDeepEqual(other.countKey, base.countKey);
  }
});

function payoutRecord(overrides = {}) {
  return {
    report_id: COMPANY_ID,
    source: "FINANCES",
    authoritative: "false",
    source_row_id: OTHER_COMPANY_ID,
    source_version_id: OTHER_COMPANY_ID,
    source_identity_id: OTHER_COMPANY_ID,
    sku_id: OTHER_COMPANY_ID,
    terms_version_id: OTHER_COMPANY_ID,
    fee_period_id: null,
    sku: "Exact SKU",
    marketplace_name: "Amazon.com",
    activity_date: "2026-06-01",
    component_type: "PRODUCT_SALES",
    currency: "USD",
    source_amount: "9007199254740993.123456789",
    quantity: null,
    fee_base: null,
    fee_rate_percent: null,
    fee_amount: null,
    company_amount: null,
    resolution_status: "resolved",
    ...overrides,
  };
}

test("derived supporting records page by saved report and preserve exact values and source identity", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/payout_report_records");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      p_report_id: COMPANY_ID,
      p_authoritative: false,
      p_limit: 50,
      p_offset: 50,
      p_types: null,
    });
    return responseJson({ rows: [payoutRecord()], total_count: "51" });
  });
  const result = await client.fetchPayoutRecords("token", COMPANY_ID, false, 1);
  assert.equal(result.totalCount, 51);
  assert.equal(result.rows[0].source_amount, "9007199254740993.123456789");
  assert.equal(result.rows[0].fee_amount, null);
  assert.equal(result.rows[0].source_row_id, OTHER_COMPANY_ID);
  assert.equal(Object.hasOwn(result.rows[0], "id"), false);
});

test("record responses reject scope swaps, numeric rounding, duplicate identities and truncated pages", async () => {
  for (const patch of [
    { report_id: OTHER_COMPANY_ID },
    { authoritative: "true" },
    { source: "OTHER" },
    { source_row_id: "" },
    { source_amount: Number.MAX_SAFE_INTEGER + 1 },
    { fee_base: "NaN" },
    { activity_date: "2026-02-30" },
    { currency: "bad" },
    { quantity: undefined },
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson({ rows: [payoutRecord(patch)], total_count: "1" }),
    );
    await assert.rejects(client.fetchPayoutRecords("token", COMPANY_ID, false, 0));
  }
  for (const value of [
    { rows: [payoutRecord()], total_count: "2" },
    { rows: [payoutRecord()], total_count: 1 },
    { rows: [payoutRecord(), payoutRecord()], total_count: "2" },
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(value));
    await assert.rejects(client.fetchPayoutRecords("token", COMPANY_ID, false, 0));
  }
  const distinctSources = createApiClient(SETTINGS, async () =>
    responseJson({
      rows: [payoutRecord(), payoutRecord({ source: "DATA_KIOSK" })],
      total_count: "2",
    }),
  );
  assert.equal(
    (await distinctSources.fetchPayoutRecords("token", COMPANY_ID, false, 0)).rows.length,
    2,
  );
});

test("an accessible zero report is empty while inaccessible records remain an error", async () => {
  const empty = createApiClient(SETTINGS, async () => responseJson({ rows: [], total_count: "0" }));
  assert.deepEqual(await empty.fetchPayoutRecords("token", COMPANY_ID, true, 0), {
    rows: [],
    totalCount: 0,
  });
  const denied = createApiClient(SETTINGS, async () =>
    responseJson({ code: "42501", message: "Report access required" }, 403),
  );
  await assert.rejects(denied.fetchPayoutRecords("token", COMPANY_ID, false, 0), /HTTP 403/);
});

test("payout type totals page exact groups across namespaces and detail filters remain literal", async () => {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    if (parsed.pathname.endsWith("/payout_report_totals")) {
      const args = JSON.parse(init.body);
      assert.equal(args.p_report_id, COMPANY_ID);
      assert.equal(args.p_group_by_type, true);
      assert.equal(args.p_limit, 1000);
      return responseJson({
        rows: [
          {
            currency: "USD",
            component_type: args.p_offset === 0 ? "PRODUCT_SALES" : "FBA_STORAGE_FEE",
            reported_amount: "9007199254740993.123456789",
            service_fee: "0",
            company_amount: "9007199254740993.123456789",
            row_count: "2",
            known_company_count: "2",
          },
        ],
        next_offset: args.p_offset === 0 ? 1 : null,
      });
    }
    assert.equal(parsed.pathname, "/rest/v1/rpc/payout_report_records");
    assert.deepEqual(JSON.parse(init.body).p_types, ['a"b', "x,y"]);
    return responseJson({ rows: [], total_count: "0" });
  });
  const totals = await client.fetchPayoutTypeTotals("token", COMPANY_ID, "USD");
  assert.equal(totals.length, 2);
  assert.equal(totals[0].companyAmount, "9007199254740993.123456789");
  await client.fetchPayoutRecords("token", COMPANY_ID, true, 0, undefined, ['a"b', "x,y"]);
  assert.equal(calls.length, 3);
});
