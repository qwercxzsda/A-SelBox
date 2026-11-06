import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { decodeSourceTotals } from "../src/api/source-totals.ts";
import { SETTINGS, COMPANY_ID, responseJson } from "./api-fixtures.mjs";

const scope = {
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  marketplace: "Amazon.com",
  grouping: "month",
};
function response({ rows, coverage, ...patch } = {}) {
  return {
    scope: {
      start_date: scope.startDate,
      end_date: scope.endDate,
      marketplace_name: scope.marketplace,
      currency: null,
    },
    revision: { finances: "f1", data_kiosk: "k1" },
    rows: rows ?? [
      {
        seller_namespace: null,
        period: "2026-07-01",
        marketplace_name: scope.marketplace,
        currency: "USD",
        source: "FINANCES",
        category: "DATA_KIOSK",
        amount: "9007199254740993.000000000000000001",
        row_count: "9007199254740993",
      },
    ],
    coverage:
      coverage ??
      ["FINANCES", "DATA_KIOSK"].map((source) => ({
        source,
        seller_namespace: "seller",
        start_date: scope.startDate,
        end_date: scope.endDate,
      })),
    total_count: "1",
    next_offset: null,
    ...patch,
  };
}

test("current native totals use explicit scope and retain exact values, coverage and revisions", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/current_source_totals");
    assert.deepEqual(JSON.parse(init.body), {
      p_start: scope.startDate,
      p_end: scope.endDate,
      p_marketplace: scope.marketplace,
      p_grouping: "month",
      p_currency: null,
      p_category: null,
      p_limit: 50,
      p_offset: 0,
    });
    return responseJson(response());
  });
  const result = await client.fetchCurrentSourceTotals("token", scope);
  assert.equal(result.rows[0].amount, "9007199254740993.000000000000000001");
  assert.equal(result.rows[0].row_count, "9007199254740993");
  assert.deepEqual(result.revision, { finances: "f1", data_kiosk: "k1" });
  assert.equal(result.coverage.length, 2);
});

test("saved native totals request only exact report identity and complete comparison buckets", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/report_source_totals");
    assert.deepEqual(JSON.parse(init.body), {
      p_report_id: COMPANY_ID,
      p_grouping: "day",
      p_limit: 50,
      p_offset: 50,
    });
    const value = response();
    value.scope.report_id = COMPANY_ID;
    value.scope.currency = "USD";
    value.revision = null;
    value.total_count = "51";
    value.rows[0].seller_namespace = "seller";
    return responseJson(value);
  });
  const result = await client.fetchReportSourceTotals("token", {
    reportId: COMPANY_ID,
    grouping: "day",
    pageIndex: 1,
  });
  assert.equal(result.totalCount, 51);
  assert.equal(result.nextOffset, null);
  assert.equal(result.rows[0].seller_namespace, "seller");
});

test("native aggregate decoding rejects cross-scope values, duplicate cells, partial pages and numeric JSON money", () => {
  const invalid = [
    (value) => {
      value.scope.end_date = "2026-08-01";
    },
    (value) => {
      value.rows[0].marketplace_name = "Amazon.ca";
    },
    (value) => {
      value.rows[0].amount = 1.5;
    },
    (value) => {
      value.rows[0].amount = "NaN";
    },
    (value) => {
      value.rows[0].row_count = "0";
    },
    (value) => {
      value.rows.push({ ...value.rows[0] });
    },
    (value) => {
      value.total_count = "2";
    },
    (value) => {
      value.next_offset = 50;
    },
    (value) => {
      value.coverage[0].start_date = "2026-06-01";
    },
    (value) => {
      value.revision.finances = "";
    },
    (value) => {
      value.rows[0].category = "ANALYSIS_ONLY";
    },
  ];
  for (const change of invalid) {
    const value = response();
    change(value);
    assert.throws(() => decodeSourceTotals(value, scope));
  }
});

test("empty saved source inventory stays empty without guessing currency or zero financial rows", () => {
  const value = response({ rows: [], coverage: [], total_count: "0", revision: null });
  value.scope = { ...value.scope, marketplace_name: null, report_id: COMPANY_ID };
  const result = decodeSourceTotals(value, { reportId: COMPANY_ID });
  assert.equal(result.scope.currency, null);
  assert.deepEqual(result.rows, []);
});

test("invalid current periods and report identities are rejected before any request", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests++;
    return responseJson(response());
  });
  for (const patch of [
    { startDate: "2026-08-01" },
    { endDate: "2026-02-30" },
    { marketplace: "unknown" },
    { currency: "US" },
    { category: "ALL" },
    { grouping: "week" },
    { pageIndex: -1 },
  ])
    await assert.rejects(client.fetchCurrentSourceTotals("token", { ...scope, ...patch }));
  await assert.rejects(client.fetchReportSourceTotals("token", { reportId: "not-a-report" }));
  assert.equal(requests, 0);
});
