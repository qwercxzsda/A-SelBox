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
  periodTotalsRequest,
} from "./api-fixtures.mjs";

const trendRow = (overrides = {}) =>
  aggregateRow({ period_start: "2024-02-05", component_type: "PRODUCT_SALES", ...overrides });
test("trends page complete exact aggregates with the same transaction filters", async () => {
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
      p_limit: 1000,
      p_offset: calls.length - 1,
    });
    return responseJson({
      rows: [rows[args.p_offset]],
      next_offset: args.p_offset === 0 ? 1 : null,
    });
  });
  const result = await client.fetchTransactionTrends(options);
  assert.equal(result.length, 2);
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
      responseJson({ rows: [trendRow(overrides)], next_offset: null }),
    );
    await assert.rejects(
      client.fetchTransactionTrends(periodTotalsRequest({ granularity: "week" })),
    );
  }
  const duplicate = createApiClient(SETTINGS, async () =>
    responseJson({ rows: [trendRow(), trendRow()], next_offset: null }),
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
    return responseJson({ rows: [], next_offset: null });
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
