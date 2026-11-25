import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import {
  MAX_TRANSACTION_TOTAL_GROUPS,
  TRANSACTION_TOTALS_LIMIT_MESSAGE,
  TransactionTotalsLimitError,
} from "../src/api/transaction-total-results.ts";
import {
  COMPANY_ID,
  SETTINGS,
  aggregateRow,
  assertRpcRequest,
  pageRequest,
  periodTotalsRequest,
  typeTotalsRequest,
  responseJson,
  transactionTotalsResult,
} from "./api-fixtures.mjs";

const totalsActions = [
  (client) => client.fetchTransactionPeriodTotals(periodTotalsRequest()),
  (client) => client.fetchTransactionTypeTotals(typeTotalsRequest()),
  (client) => client.fetchTransactionTrends(periodTotalsRequest({ granularity: "day" })),
  (client) => client.fetchTransactionTrends(periodTotalsRequest({ granularity: "week" })),
];
const validDetails = JSON.stringify({
  code: "TRANSACTION_TOTAL_GROUP_LIMIT",
  limit: MAX_TRANSACTION_TOTAL_GROUPS,
});
const limitBody = {
  code: "22023",
  message: "private database diagnostic",
  details: validDetails,
  hint: "private database hint",
};

test("every live totals mode surfaces the actionable group limit without exposing server text", async () => {
  assert.equal(MAX_TRANSACTION_TOTAL_GROUPS, 100000);
  for (const action of totalsActions) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (url) => {
      calls += 1;
      assert.equal(new URL(url).pathname, "/rest/v1/rpc/transaction_totals");
      return responseJson(limitBody, 400);
    });
    await assert.rejects(action(client), (error) => {
      assert.ok(error instanceof TransactionTotalsLimitError);
      assert.equal(error.message, TRANSACTION_TOTALS_LIMIT_MESSAGE);
      assert.equal(error.message, "Too many records. Choose fewer dates or filters.");
      assert.equal(error.message.includes("private"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("only the exact structured totals-limit error is public and other failures remain private", async () => {
  for (const [body, status] of [
    [{ ...limitBody, code: "54000" }, 400],
    [{ ...limitBody, code: "42501" }, 400],
    [{ ...limitBody, details: undefined }, 400],
    [{ ...limitBody, details: "private SQL detail" }, 400],
    [
      {
        ...limitBody,
        details: JSON.stringify({ code: "TRANSACTION_TOTAL_GROUP_LIMIT", limit: "100000" }),
      },
      400,
    ],
    [
      {
        ...limitBody,
        details: JSON.stringify({ code: "TRANSACTION_TOTAL_GROUP_LIMIT", limit: 99999 }),
      },
      400,
    ],
    [{ ...limitBody, details: JSON.stringify({ code: "ANOTHER_LIMIT", limit: 100000 }) }, 400],
    [{ ...limitBody, details: { code: "TRANSACTION_TOTAL_GROUP_LIMIT", limit: 100000 } }, 400],
    [limitBody, 403],
    [limitBody, 500],
  ]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async () => {
      calls += 1;
      return responseJson(body, status);
    });
    await assert.rejects(client.fetchTransactionPeriodTotals(periodTotalsRequest()), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private"), false);
      assert.notEqual(error.message, TRANSACTION_TOTALS_LIMIT_MESSAGE);
      return true;
    });
    assert.equal(calls, 1);
  }
  const malformed = createApiClient(
    SETTINGS,
    async () => new Response("private non-JSON error", { status: 400 }),
  );
  await assert.rejects(malformed.fetchTransactionPeriodTotals(periodTotalsRequest()), ApiError);
});

test("the totals-limit allowlist does not apply to transaction pages, source pages or payout totals", async () => {
  for (const action of [
    (client) => client.fetchDatasetPage(pageRequest()),
    (client) => client.fetchDatasetPage(pageRequest("finances")),
    (client) => client.fetchPayoutTypeTotals("test-access", COMPANY_ID, "USD"),
  ]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (url) => {
      calls += 1;
      assert.notEqual(new URL(url).pathname, "/rest/v1/rpc/transaction_totals");
      return responseJson(limitBody, 400);
    });
    await assert.rejects(action(client), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("oversized successful totals responses are rejected before any partial data can escape", async () => {
  const payload = transactionTotalsResult(
    Array.from({ length: MAX_TRANSACTION_TOTAL_GROUPS + 1 }, () => null),
  );
  for (const action of totalsActions) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async () => {
      calls += 1;
      return responseJson(payload);
    });
    await assert.rejects(action(client), /invalid or incomplete aggregate/);
    assert.equal(calls, 1);
  }
});

test("the exact group-cap boundary remains a complete successful one-request result", async () => {
  const rows = Array.from({ length: MAX_TRANSACTION_TOTAL_GROUPS }, (_, index) =>
    aggregateRow({
      marketplace_name: `Market-${String(index)}`,
      reported_amount: "1.000000001",
      company_amount: "1.000000001",
    }),
  );
  let calls = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    calls += 1;
    const args = assertRpcRequest(assert, url, init, "transaction_totals");
    assert.equal(Object.hasOwn(args, "p_offset"), false);
    assert.equal(Object.hasOwn(args, "p_limit"), false);
    return responseJson(transactionTotalsResult(rows));
  });
  const result = await client.fetchTransactionPeriodTotals(periodTotalsRequest());
  assert.equal(result.length, MAX_TRANSACTION_TOTAL_GROUPS);
  assert.equal(result.at(-1).marketplace, "Market-99999");
  assert.equal(result.at(-1).companyAmount, "1.000000001");
  assert.equal(calls, 1);
});
