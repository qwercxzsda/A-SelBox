import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { transactionFilterArguments } from "../src/api/transaction-page.ts";
import {
  SETTINGS,
  aggregateRow,
  datasetRecord,
  assertRpcRequest,
  responseJson,
  latestDateRequest,
  periodTotalsRequest,
} from "./api-fixtures.mjs";

test("one shared UTC anchor uses the latest accessible transaction without any UI filter", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    const args = assertRpcRequest(assert, url, init, "transaction_page");
    assert.deepEqual(args, {
      p_date_from: null,
      p_date_to: null,
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
      p_limit: 1,
      p_offset: 0,
      p_direction: "desc",
      p_order_by: "date",
      p_include_count: false,
    });
    return responseJson({
      rows: [
        datasetRecord("live", {
          activity_date: "2026-11-06",
          activity_at: "2026-11-07T07:59:59.999999Z",
        }),
      ],
      total_count: null,
    });
  });
  assert.equal(
    await client.fetchLatestTransactionDate(
      latestDateRequest({
        companyIds: ["not-a-company"],
        skus: ["anything"],
        marketplaces: ["Amazon.co.jp"],
        dateFrom: "2020-01-01",
        dateTo: "2020-01-31",
        sources: ["DATA_KIOSK"],
        types: ["PRODUCT_SALES"],
        search: "ignored",
        feeApplicability: ["applicable"],
      }),
    ),
    "2026-11-07",
  );
});

test("UTC anchor converts timestamp offsets instead of trusting the source calendar date", async () => {
  const client = createApiClient(SETTINGS, async () =>
    responseJson({
      rows: [
        datasetRecord("live", {
          activity_date: "2026-11-07",
          activity_at: "2026-11-07T00:15:00+09:00",
        }),
      ],
      total_count: null,
    }),
  );
  assert.equal(await client.fetchLatestTransactionDate(latestDateRequest()), "2026-11-06");
});

test("latest date distinguishes no accessible transactions from invalid page results", async () => {
  const empty = createApiClient(SETTINGS, async () =>
    responseJson({ rows: [], total_count: null }),
  );
  assert.equal(await empty.fetchLatestTransactionDate(latestDateRequest()), null);
  for (const rows of [
    [null],
    ...[null, "", "not-a-timestamp", "2026-11-07T00:00:00", undefined].map((activity_at) => [
      datasetRecord("live", { activity_at }),
    ]),
    [datasetRecord("live"), datasetRecord("live")],
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson({ rows, total_count: null }));
    await assert.rejects(client.fetchLatestTransactionDate(latestDateRequest()));
  }
});

test("latest-date cancellation preserves the original abort reason", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, { signal }) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/transaction_page");
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
  });
  const pending = client.fetchLatestTransactionDate(
    latestDateRequest({ signal: controller.signal }),
  );
  const rejected = assert.rejects(pending, (error) => error === controller.signal.reason);
  controller.abort();
  await rejected;
});

test("bounded totals RPC preserves exact nullable amounts across explicitly capped pages", async () => {
  const requests = [];
  const rows = [
    aggregateRow({
      currency: "EUR",
      reported_amount: "50",
      service_fee: null,
      company_amount: null,
      known_company_count: "0",
    }),
    aggregateRow({
      reported_amount: "200.123456789012345678",
      service_fee: "-10",
      company_amount: "190.123456789012345678",
      row_count: "4",
      known_company_count: "4",
    }),
  ];
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
      p_currency: null,
      p_group_by_type: false,
      p_limit: 1000,
      p_offset: requests.length - 1,
    });
    assert.ok(init.signal instanceof AbortSignal);
    return responseJson({
      rows: [rows[args.p_offset]],
      next_offset: args.p_offset === 0 ? 1 : null,
    });
  });
  assert.deepEqual(
    await client.fetchTransactionPeriodTotals(
      periodTotalsRequest({
        signal,
      }),
    ),
    [
      {
        marketplace: "Amazon.com",
        currency: "EUR",
        reportedAmount: "50",
        serviceFee: null,
        companyAmount: null,
        rowCount: 1,
        missingFeeCount: 1,
      },
      {
        marketplace: "Amazon.com",
        currency: "USD",
        reportedAmount: "200.123456789012345678",
        serviceFee: "-10",
        companyAmount: "190.123456789012345678",
        rowCount: 4,
        missingFeeCount: 0,
      },
    ],
  );
  assert.deepEqual(
    requests.map((args) => args.p_offset),
    [0, 1],
  );
});

test("period totals validate date bounds before HTTP and support open-ended ranges", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push(assertRpcRequest(assert, url, init, "transaction_totals"));
    return responseJson({ rows: [], next_offset: null });
  });
  for (const overrides of [
    { accessToken: " " },
    { dateFrom: "", dateTo: "" },
    { dateFrom: "2024-02-30" },
    { dateTo: "2025-02-29" },
    { dateFrom: "0000-01-01" },
    { dateFrom: "2024-03-01" },
    { dateTo: "2024-02-29T00:00:00Z" },
  ])
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest(overrides)));
  assert.equal(requests.length, 0);
  assert.deepEqual(
    await client.fetchTransactionPeriodTotals(periodTotalsRequest({ dateTo: "" })),
    [],
  );
  assert.deepEqual(
    await client.fetchTransactionPeriodTotals(periodTotalsRequest({ dateFrom: "" })),
    [],
  );
  assert.equal(requests[0].p_date_from, "2024-02-01");
  assert.equal(requests[0].p_date_to, null);
  assert.equal(requests[1].p_date_from, null);
  assert.equal(requests[1].p_date_to, "2024-02-29");
});

test("period and type totals use exactly the record filters, including resolved empty searches", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push(assertRpcRequest(assert, url, init, "transaction_totals"));
    return responseJson({ rows: [], next_offset: null });
  });
  for (const searchValues of [
    { skus: ['Exact, "SKU"'], types: ["PRODUCT_SALES"], marketplaces: [], sources: [] },
    { skus: [], types: [], marketplaces: [], sources: [] },
  ]) {
    const options = periodTotalsRequest({
      companyIds: ["11111111-1111-4111-8111-111111111111"],
      skus: ['Exact, "SKU"'],
      marketplaces: ["Amazon.com"],
      sources: ["FINANCES"],
      types: ["PRODUCT_SALES", "PRODUCT_REFUNDS"],
      feeApplicability: ["applicable"],
      search: "Exact",
      searchValues,
    });
    const filters = transactionFilterArguments({ ...options, dataset: "live", filters: options });
    await client.fetchTransactionPeriodTotals(options);
    await client.fetchTransactionTypeTotals({ ...options, currency: "USD" });
    for (const [request, currency] of [
      [requests.at(-2), null],
      [requests.at(-1), "USD"],
    ]) {
      assert.deepEqual(request, {
        ...filters,
        p_currency: currency,
        p_group_by_type: currency !== null,
        p_limit: 1000,
        p_offset: 0,
      });
    }
  }
  const count = requests.length;
  for (const overrides of [
    { search: "unresolved" },
    { feeApplicability: ["invalid"] },
    { sources: [""] },
    { types: ["\0"] },
  ]) {
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest(overrides)));
    await assert.rejects(
      client.fetchTransactionTypeTotals({ ...periodTotalsRequest(overrides), currency: "USD" }),
    );
  }
  assert.equal(requests.length, count);
});

test("period totals preserve separate marketplaces sharing a currency across pages", async () => {
  const rows = [
    aggregateRow({ marketplace_name: "Amazon.ca", reported_amount: "12.75" }),
    aggregateRow({ marketplace_name: "Amazon.com", reported_amount: "85.25" }),
  ];
  const client = createApiClient(SETTINGS, async (_url, init) => {
    const { p_offset: offset } = JSON.parse(init.body);
    return responseJson({ rows: [rows[offset]], next_offset: offset === 0 ? 1 : null });
  });
  const totals = await client.fetchTransactionPeriodTotals(periodTotalsRequest());
  assert.deepEqual(
    totals.map(({ marketplace, currency, reportedAmount }) => ({
      marketplace,
      currency,
      reportedAmount,
    })),
    [
      { marketplace: "Amazon.ca", currency: "USD", reportedAmount: "12.75" },
      { marketplace: "Amazon.com", currency: "USD", reportedAmount: "85.25" },
    ],
  );
});

test("totals reject malformed, truncated, oversized, repeated, or non-advancing pages", async () => {
  const row = aggregateRow();
  for (const payload of [
    null,
    [],
    {},
    { rows: [] },
    { rows: [row] },
    { rows: null, next_offset: null },
    { rows: [], next_offset: 1 },
    { rows: [row], next_offset: 0 },
    { rows: [row], next_offset: 2 },
    { rows: [row], next_offset: "1" },
    { rows: [row], next_offset: -1 },
    { rows: [row, row], next_offset: null },
    {
      rows: Array.from({ length: 1001 }, (_, i) =>
        aggregateRow({
          currency: String.fromCharCode(
            65 + Math.floor(i / 676),
            65 + (Math.floor(i / 26) % 26),
            65 + (i % 26),
          ),
        }),
      ),
      next_offset: null,
    },
  ]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () => {
      requests += 1;
      return responseJson(payload);
    });
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest()));
    assert.equal(requests, 1);
  }
  for (const second of [
    { rows: [], next_offset: null },
    { rows: [row], next_offset: null },
  ]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () =>
      responseJson(++requests === 1 ? { rows: [row], next_offset: 1 } : second),
    );
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest()));
    assert.equal(requests, 2);
  }
});

test("totals reject invalid financial fields and preserve missing-fee information", async () => {
  for (const overrides of [
    { reported_amount: "NaN" },
    { reported_amount: 1 },
    { reported_amount: undefined },
    { service_fee: 0 },
    { company_amount: "Infinity" },
    { currency: "usd" },
    { currency: null },
    { marketplace_name: null },
    { marketplace_name: undefined },
    { marketplace_name: "" },
    { marketplace_name: " " },
    { marketplace_name: "Amazon\0com" },
    { marketplace_name: 1 },
    { known_company_count: "2" },
    { known_company_count: 1 },
    { row_count: "0" },
    { row_count: "-1" },
    { row_count: "1.1" },
    { row_count: "9007199254740992" },
    { component_type: "PRODUCT_SALES" },
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson({ rows: [aggregateRow(overrides)], next_offset: null }),
    );
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest()));
  }
  const client = createApiClient(SETTINGS, async () =>
    responseJson({ rows: [], next_offset: null }),
  );
  assert.deepEqual(await client.fetchTransactionPeriodTotals(periodTotalsRequest()), []);
});

test("aggregate pagination and SKU catalogs preserve cancellation even if transport ignores abort", async () => {
  for (const action of [
    (client, signal) => client.fetchTransactionPeriodTotals(periodTotalsRequest({ signal })),
    (client, signal) => client.fetchSkuOptions("test-access", signal),
  ]) {
    const alreadyAborted = new AbortController();
    const reason = new Error("cancelled request");
    alreadyAborted.abort(reason);
    const unused = createApiClient(SETTINGS, () => assert.fail("Aborted work must not reach HTTP"));
    await assert.rejects(action(unused, alreadyAborted.signal), (error) => error === reason);
    const controller = new AbortController();
    let calls = 0;
    const client = createApiClient(SETTINGS, async () => {
      calls += 1;
      controller.abort(reason);
      return responseJson({ rows: [], next_offset: null, values: [] });
    });
    await assert.rejects(action(client, controller.signal), (error) => error === reason);
    assert.equal(calls, 1);
  }
});
