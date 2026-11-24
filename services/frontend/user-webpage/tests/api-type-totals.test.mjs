import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import {
  SETTINGS,
  responseJson,
  transactionTotalsResult,
  aggregateRow,
  assertRpcRequest,
  typeTotalsRequest,
} from "./api-fixtures.mjs";

test("type totals filter card dates and currency and return every exact group in one response", async () => {
  const stored = [
    {
      component_type: 'Fee,"quoted"',
      currency: "USD",
      reported_amount: "-10.123456789012345678901234567890",
      service_fee: "0",
      company_amount: "-10.123456789012345678901234567890",
      row_count: "1300",
      known_company_count: "1300",
    },
    {
      component_type: "RESTOCKING",
      currency: "USD",
      reported_amount: "9007199254740993.000000000000000001",
      service_fee: "-0.000000000000000001",
      company_amount: "9007199254740993.000000000000000000",
      row_count: "3",
      known_company_count: "1",
    },
    {
      component_type: "OTHER",
      currency: "USD",
      reported_amount: "1",
      service_fee: null,
      company_amount: null,
      row_count: "1",
      known_company_count: "0",
    },
  ];
  const requests = [];
  const signal = new AbortController().signal;
  const client = createApiClient(SETTINGS, async (url, init) => {
    const args = assertRpcRequest(assert, url, init, "transaction_totals");
    requests.push(args);
    assert.deepEqual(args, {
      p_date_from: "2024-02-01",
      p_date_to: "2024-02-29",
      p_company_ids: [],
      p_skus: [],
      p_marketplaces: [],
      p_sources: [],
      p_types: [],
      p_fee_applicable: null,
      p_search_skus: null,
      p_search_types: null,
      p_search_marketplaces: null,
      p_search_sources: null,
      p_currency: "USD",
      p_group_by_type: true,
    });
    assert.ok(init.signal instanceof AbortSignal);
    return responseJson(transactionTotalsResult(stored));
  });
  assert.deepEqual(await client.fetchTransactionTypeTotals(typeTotalsRequest({ signal })), [
    {
      type: 'Fee,"quoted"',
      currency: "USD",
      reportedAmount: "-10.123456789012345678901234567890",
      serviceFee: "0",
      companyAmount: "-10.123456789012345678901234567890",
      rowCount: 1300,
      missingFeeCount: 0,
    },
    {
      type: "RESTOCKING",
      currency: "USD",
      reportedAmount: "9007199254740993.000000000000000001",
      serviceFee: "-0.000000000000000001",
      companyAmount: "9007199254740993.000000000000000000",
      rowCount: 3,
      missingFeeCount: 2,
    },
    {
      type: "OTHER",
      currency: "USD",
      reportedAmount: "1",
      serviceFee: null,
      companyAmount: null,
      rowCount: 1,
      missingFeeCount: 1,
    },
  ]);
  assert.equal(requests.length, 1);
});

test("type totals reject invalid scopes before HTTP and allow either single date bound", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push(assertRpcRequest(assert, url, init, "transaction_totals"));
    return responseJson(transactionTotalsResult());
  });
  for (const overrides of [
    { accessToken: " " },
    { dateFrom: "", dateTo: "" },
    { dateFrom: "2024-02-30" },
    { dateTo: "2025-02-29" },
    { dateFrom: "0000-01-01" },
    { dateFrom: "2024-03-01" },
    { dateTo: "2024-02-29T00:00:00Z" },
    { currency: "" },
    { currency: "usd" },
    { currency: "USD,or(currency.eq.EUR)" },
  ]) {
    await assert.rejects(client.fetchTransactionTypeTotals(typeTotalsRequest(overrides)));
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(await client.fetchTransactionTypeTotals(typeTotalsRequest({ dateTo: "" })), []);
  assert.deepEqual(
    await client.fetchTransactionTypeTotals(typeTotalsRequest({ dateFrom: "" })),
    [],
  );
  assert.equal(requests[0].p_date_from, "2024-02-01");
  assert.equal(requests[0].p_date_to, null);
  assert.equal(requests[1].p_date_from, null);
  assert.equal(requests[1].p_date_to, "2024-02-29");
});

test("type totals reject invalid groups and mismatched currency rather than display wrong amounts", async () => {
  const row = {
    component_type: "PRODUCT_SALES",
    currency: "USD",
    reported_amount: "1",
    service_fee: "0",
    company_amount: "1",
    row_count: "1",
    known_company_count: "1",
  };
  for (const overrides of [
    { component_type: " " },
    { component_type: null },
    { currency: "EUR" },
    { company_amount: "NaN" },
    { known_company_count: "2" },
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson(transactionTotalsResult([{ ...row, ...overrides }])),
    );
    await assert.rejects(client.fetchTransactionTypeTotals(typeTotalsRequest()), /Aggregation/);
  }
});

test("cancelling type totals interrupts its single request with the original abort reason", async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  let calls = 0;
  const client = createApiClient(SETTINGS, async (url, { signal, body }) => {
    calls += 1;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/transaction_totals");
    const args = JSON.parse(body);
    assert.deepEqual(args.p_skus, ["Cancel SKU"]);
    assert.deepEqual(args.p_marketplaces, ["Amazon.com"]);
    assert.equal(Object.hasOwn(args, "p_offset"), false);
    assert.equal(Object.hasOwn(args, "p_limit"), false);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      started.resolve();
    });
  });
  const pending = client.fetchTransactionTypeTotals(
    typeTotalsRequest({
      signal: controller.signal,
      skus: ["Cancel SKU"],
      marketplaces: ["Amazon.com"],
    }),
  );
  const reason = new Error("cancelled type totals");
  const rejected = assert.rejects(pending, (error) => error === reason);
  await started.promise;
  controller.abort(reason);
  await rejected;
  assert.equal(calls, 1);
});

test("type totals fetch more than a thousand groups with exactly one request", async () => {
  const stored = Array.from({ length: 1002 }, (_, index) =>
    aggregateRow({ component_type: `TYPE-${String(index).padStart(4, "0")}` }),
  );
  let requests = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests += 1;
    const args = assertRpcRequest(assert, url, init, "transaction_totals");
    assert.equal(Object.hasOwn(args, "p_limit"), false);
    assert.equal(Object.hasOwn(args, "p_offset"), false);
    return responseJson(transactionTotalsResult(stored));
  });
  const totals = await client.fetchTransactionTypeTotals(typeTotalsRequest());
  assert.equal(totals.length, stored.length);
  assert.equal(totals.at(-1).type, "TYPE-1001");
  assert.equal(requests, 1);
});

test("type totals reject duplicate exact types even when their amounts differ", async () => {
  const client = createApiClient(SETTINGS, async () =>
    responseJson(
      transactionTotalsResult([
        aggregateRow({ component_type: "PRODUCT_SALES" }),
        aggregateRow({ component_type: "PRODUCT_SALES", company_amount: "25" }),
      ]),
    ),
  );
  await assert.rejects(client.fetchTransactionTypeTotals(typeTotalsRequest()), /duplicate group/);
});
