import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import {
  SETTINGS,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  responseJson,
  csvRecord,
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
        "start_date.desc.nullslast,company_id.asc,currency.asc,id.asc",
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

test("saved elaboration is selected separately and preserves decimal strings", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("report_id"), `eq.${COMPANY_ID}`);
    assert.equal(params.get("authoritative"), "eq.false");
    assert.equal(params.get("offset"), "50");
    return new Response(
      csvRecord({
        id: OTHER_COMPANY_ID,
        source_amount: "9007199254740993.123456789",
        fee_amount: null,
      }),
      { headers: { "Content-Range": "50-50/51" } },
    );
  });
  const result = await client.fetchPayoutComponents("token", COMPANY_ID, false, 1);
  assert.equal(result.rows[0].source_amount, "9007199254740993.123456789");
  assert.equal(result.rows[0].fee_amount, null);
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
    assert.equal(parsed.searchParams.get("or"), null);
    assert.equal(parsed.searchParams.get("component_type"), String.raw`in.("a\"b","x,y")`);
    return new Response("id\n", { headers: { "Content-Range": "*/0" } });
  });
  const totals = await client.fetchPayoutTypeTotals("token", COMPANY_ID, "USD");
  assert.equal(totals.length, 2);
  assert.equal(totals[0].companyAmount, "9007199254740993.123456789");
  await client.fetchPayoutComponents("token", COMPANY_ID, true, 0, undefined, ['a"b', "x,y"]);
  assert.equal(calls.length, 3);
});

test("payout eligibility comes from the server and validates calendar dates", async () => {
  const policy = {
    mature_cutoff_date: "2026-07-27",
    latest_month: "2026-06-01",
    mature_cutoff_months: 2,
  };
  const client = createApiClient(SETTINGS, async () => responseJson(policy));
  assert.deepEqual(await client.fetchPayoutPolicy("token"), policy);
  policy.mature_cutoff_date = "2026-02-30";
  await assert.rejects(client.fetchPayoutPolicy("token"), /valid calendar date/);
});

test("saved seller reconciliation uses its separate report-scoped endpoint and exact decimals", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    assert.equal(new URL(url).pathname, "/rest/v1/payout_report_reconciliation");
    const params = new URL(url).searchParams;
    assert.equal(params.get("report_id"), `eq.${COMPANY_ID}`);
    assert.equal(params.get("offset"), "50");
    assert.equal(params.get("order"), "row_number.asc");
    return new Response(
      csvRecord({
        report_id: COMPANY_ID,
        row_number: "51",
        difference: "-0.000000000000000123",
        marketplace_name: null,
      }),
      { headers: { "Content-Range": "50-50/51" } },
    );
  });
  const result = await client.fetchPayoutReconciliation("token", COMPANY_ID, 1);
  assert.equal(result.rows[0].difference, "-0.000000000000000123");
  assert.equal(result.rows[0].marketplace_name, null);
});

test("saved marketplace totals use the report-scoped CSV view and preserve exact amounts", async () => {
  const controller = new AbortController();
  let requests = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests += 1;
    assert.equal(new URL(url).pathname, "/rest/v1/payout_report_marketplace_totals");
    const params = new URL(url).searchParams;
    assert.equal(params.get("report_id"), `eq.${COMPANY_ID}`);
    assert.equal(params.get("limit"), "25");
    assert.equal(params.get("order"), "marketplace_name.asc.nullslast");
    assert.equal(init.headers.Accept, "text/csv");
    assert.equal(init.headers.Authorization, "Bearer token");
    assert.equal(init.signal, controller.signal);
    return new Response(
      csvRecord({
        report_id: COMPANY_ID,
        marketplace_name: null,
        source_amount: "9007199254740993.123456789",
        fee_amount: "-0.000000001",
        company_amount: "9007199254740993.123456788",
      }),
    );
  });
  const [row] = await client.fetchPayoutMarketplaceTotals("token", COMPANY_ID, controller.signal);
  assert.equal(row.marketplace_name, null);
  assert.equal(row.source_amount, "9007199254740993.123456789");
  assert.equal(row.fee_amount, "-0.000000001");
  assert.equal(row.company_amount, "9007199254740993.123456788");
  await assert.rejects(client.fetchPayoutMarketplaceTotals("token", "invalid"), /report ID/);
  assert.equal(requests, 1);
});
