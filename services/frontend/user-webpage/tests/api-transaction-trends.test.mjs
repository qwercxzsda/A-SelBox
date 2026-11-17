import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { transactionFilterArguments } from "../src/api/transaction-page.ts";
import { queryRevisionSources } from "../src/workspace-revisions.ts";
import {
  SETTINGS,
  COMPANY_ID,
  aggregateRow,
  assertRpcRequest,
  responseJson,
  transactionTotalsResult,
  periodTotalsRequest,
} from "./api-fixtures.mjs";

const trendRow = (overrides = {}) =>
  aggregateRow({ period_start: "2024-02-05", component_type: "PRODUCT_SALES", ...overrides });
test("trends load complete exact aggregates in one request with the same transaction filters", async () => {
  const options = periodTotalsRequest({
    granularity: "week",
    companyIds: [COMPANY_ID],
    skus: ["A"],
    marketplaces: ["Amazon.com"],
    sources: ["FINANCES"],
    types: ["PRODUCT_SALES"],
    feeApplicability: ["applicable"],
    search: "A",
    searchValues: { skus: ["A"], types: [], marketplaces: [], sources: [] },
  });
  const calls = [];
  const rows = [
    trendRow({ company_amount: "1.123456789012345678" }),
    trendRow({ period_start: "2024-02-12", company_amount: null, known_company_count: "0" }),
  ];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const args = assertRpcRequest(assert, url, init, "transaction_totals");
    calls.push(args);
    assert.deepEqual(args, {
      ...transactionFilterArguments({
        accessToken: options.accessToken,
        dataset: "live",
        search: options.search,
        searchValues: options.searchValues,
        filters: options,
      }),
      p_granularity: "week",
    });
    return responseJson(transactionTotalsResult(rows));
  });
  const result = await client.fetchTransactionTrends(options);
  assert.equal(result.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(result[0].companyAmount, "1.123456789012345678");
  assert.equal(result[1].companyAmount, null);
  assert.equal(result[1].missingFeeCount, 1);
  assert.deepEqual(queryRevisionSources(["transaction-trends"]), [
    "finances",
    "data_kiosk",
    "fees",
  ]);
});

test("trends reject malformed buckets, incomplete amounts and repeated groups", async () => {
  for (const overrides of [
    { period_start: "2024-02-30" },
    { period_start: "2024-02-06" },
    { period_start: null },
    { component_type: "" },
    { marketplace_name: "" },
    { company_amount: null },
    { known_company_count: "0" },
    { row_count: "0" },
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson(transactionTotalsResult([trendRow(overrides)])),
    );
    await assert.rejects(
      client.fetchTransactionTrends(periodTotalsRequest({ granularity: "week" })),
    );
  }
  const duplicate = createApiClient(SETTINGS, async () =>
    responseJson(transactionTotalsResult([trendRow(), trendRow()])),
  );
  await assert.rejects(
    duplicate.fetchTransactionTrends(periodTotalsRequest({ granularity: "day" })),
    /duplicate group/,
  );
});

test("trends reject missing dates or invalid granularity before fetching", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests++;
    return responseJson(transactionTotalsResult());
  });
  await assert.rejects(
    client.fetchTransactionTrends(periodTotalsRequest({ granularity: "month" })),
  );
  await assert.rejects(
    client.fetchTransactionTrends(
      periodTotalsRequest({ granularity: "day", dateFrom: "", dateTo: "" }),
    ),
  );
  assert.equal(requests, 0);
  assert.deepEqual(
    await client.fetchTransactionTrends(periodTotalsRequest({ granularity: "day", dateFrom: "" })),
    [],
  );
});

test("daily and weekly trends load more than a thousand groups with one request each", async () => {
  const rows = Array.from({ length: 1002 }, (_, index) =>
    trendRow({
      component_type: `TYPE-${String(index).padStart(4, "0")}`,
      company_amount: `${String(index)}.123456789012345678`,
    }),
  );
  for (const granularity of ["day", "week"]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (url, init) => {
      calls += 1;
      const args = assertRpcRequest(assert, url, init, "transaction_totals");
      assert.equal(args.p_granularity, granularity);
      assert.equal(Object.hasOwn(args, "p_limit"), false);
      assert.equal(Object.hasOwn(args, "p_offset"), false);
      return responseJson(transactionTotalsResult(rows));
    });
    const result = await client.fetchTransactionTrends(periodTotalsRequest({ granularity }));
    assert.equal(calls, 1);
    assert.equal(result.length, rows.length);
    assert.equal(result.at(-1).companyAmount, "1001.123456789012345678");
  }
});

test("trend identities retain periods, marketplaces, currencies and exact types independently", async () => {
  const rows = [
    trendRow(),
    trendRow({ period_start: "2024-02-12" }),
    trendRow({ marketplace_name: "Amazon.ca" }),
    trendRow({ currency: "CAD" }),
    trendRow({ component_type: "PRODUCT_REFUNDS" }),
  ];
  const client = createApiClient(SETTINGS, async () => responseJson(transactionTotalsResult(rows)));
  const result = await client.fetchTransactionTrends(periodTotalsRequest({ granularity: "week" }));
  assert.equal(result.length, 5);
});

test("trend cancellation preserves the caller reason before and during its single request", async () => {
  const reason = new Error("cancelled trends");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(reason);
  const unused = createApiClient(SETTINGS, () => assert.fail("Aborted trends must not reach HTTP"));
  await assert.rejects(
    unused.fetchTransactionTrends(
      periodTotalsRequest({ granularity: "day", signal: alreadyAborted.signal }),
    ),
    (error) => error === reason,
  );
  const controller = new AbortController();
  const started = Promise.withResolvers();
  let requests = 0;
  const client = createApiClient(SETTINGS, async (_url, { signal }) => {
    requests += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      started.resolve();
    });
  });
  const pending = client.fetchTransactionTrends(
    periodTotalsRequest({ granularity: "week", signal: controller.signal }),
  );
  const rejected = assert.rejects(pending, (error) => error === reason);
  await started.promise;
  controller.abort(reason);
  await rejected;
  assert.equal(requests, 1);
});
