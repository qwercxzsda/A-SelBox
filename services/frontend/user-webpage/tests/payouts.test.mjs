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

test("payout generation sends company and first day and preserves created or reused results", async () => {
  const results = [
    { report_id: OTHER_COMPANY_ID, created: true },
    { report_id: COMPANY_ID, created: false },
  ];
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/generate_company_payout_reports");
    assert.deepEqual(JSON.parse(init.body), { p_company_id: COMPANY_ID, p_month: "2026-06-01" });
    assert.equal(init.headers.Authorization, "Bearer token");
    return responseJson(results);
  });
  assert.deepEqual(await client.generatePayoutReports("token", COMPANY_ID, "2026-06-01"), results);
  await assert.rejects(
    client.generatePayoutReports("token", COMPANY_ID, "2026-06-02"),
    /complete calendar month/,
  );
  await assert.rejects(
    client.generatePayoutReports("token", "invalid", "2026-06-01"),
    /company ID/,
  );
});

test("payout generation requires nonempty unique report IDs and explicit boolean outcomes", async () => {
  const report = { report_id: OTHER_COMPANY_ID, created: true };
  for (const response of [
    null,
    {},
    [],
    [null],
    [{ ...report, report_id: "invalid" }],
    [{ report_id: OTHER_COMPANY_ID }],
    [{ ...report, created: null }],
    [{ ...report, created: "false" }],
    [{ ...report, created: 0 }],
    [report, { ...report, created: false }],
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(response));
    await assert.rejects(client.generatePayoutReports("token", COMPANY_ID, "2026-06-01"), {
      message: "Payout generation returned invalid results",
    });
  }
});

test("payout list and count share company and monthly filters", async () => {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("company_id"), `in.(${COMPANY_ID})`);
    assert.deepEqual(params.getAll("start_date"), ["gte.2026-06-01", "lte.2026-06-01"]);
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

test("known payout blockers are actionable while arbitrary database errors remain private", async () => {
  for (const [message, safeMessage] of [
    [
      "Unresolved ownership or fee coverage prevents a complete payout report",
      "Required SKU ownership or service fee rates are missing for this month.",
    ],
    [
      "The selected month is not yet eligible for a payout report",
      "This month includes recent dates and cannot be used for a payout report.",
    ],
    [
      "Incomplete, pruned or incompatible payout Data Kiosk coverage",
      "Complete, compatible Data Kiosk coverage is required for this month’s Data Kiosk category amounts.",
    ],
    [
      "Source preprocessing versions must agree for a monthly payout",
      "Settlement and Data Kiosk inputs must use the same processing version for this month.",
    ],
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson({ code: "23514", message }, 400),
    );
    await assert.rejects(client.generatePayoutReports("token", COMPANY_ID, "2026-06-01"), {
      message: safeMessage,
    });
  }
  const client = createApiClient(SETTINGS, async () =>
    responseJson({ code: "23514", message: "private database details" }, 400),
  );
  await assert.rejects(client.generatePayoutReports("token", COMPANY_ID, "2026-06-01"), {
    message: "Generate payout reports failed with HTTP 400",
  });
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
