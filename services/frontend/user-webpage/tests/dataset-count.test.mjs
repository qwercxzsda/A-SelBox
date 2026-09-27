import { searchValues } from "./search-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { normalizeDatasetFilters } from "../src/dataset-filters.ts";

const SETTINGS = { supabaseUrl: "https://example.invalid", publishableKey: "sb_publishable_test" };
const OPTIONS = { dataset: "live", search: "", accessToken: "test-token" };

test("financial counts use typed filters without ordering, pagination, or lossy numeric JSON", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify("9007199254740991"));
  });
  const controller = new AbortController();
  const filters = normalizeDatasetFilters({
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    companyIds: ["11111111-1111-4111-8111-111111111111"],
    skus: ['sku,"quoted"\\한글'],
    marketplaces: ["Amazon.com"],
    sources: ["SETTLEMENT"],
    types: ["PRINCIPAL"],
  });
  assert.equal(
    await client.fetchDatasetCount({ ...OPTIONS, filters, signal: controller.signal }),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(requests[0].url, "https://example.invalid/rest/v1/rpc/transaction_count");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.signal, controller.signal);
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_company_ids: filters.companyIds,
    p_skus: filters.skus,
    p_marketplaces: filters.marketplaces,
    p_sources: filters.sources,
    p_types: filters.types,
    p_fee_applicable: null,
    p_search_skus: null,
    p_search_types: null,
    p_search_marketplaces: null,
    p_search_sources: null,
  });
});

test("all transaction counts use the same literal search RPC arguments as their pages", async () => {
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    const requests = [];
    const client = createApiClient(SETTINGS, async (url, init) => {
      const args = JSON.parse(init.body);
      requests.push(args);
      assert.equal(init.method, "POST");
      assert.equal(new URL(url).search, "");
      assert.equal(new Headers(init.headers).has("Prefer"), false);
      return new Response(
        JSON.stringify(
          new URL(url).pathname.endsWith("_count") ? "31" : { rows: [], total_count: null },
        ),
      );
    });
    const filters = normalizeDatasetFilters({
      dateFrom: "2026-09-01",
      skus: ["SK_U%"],
      marketplaces: ["Amazon.com"],
      types: ["PRINCIPAL"],
    });
    const options = {
      ...OPTIONS,
      dataset,
      search: " MISSING_FEE%*\\ ",
      searchValues: searchValues({ skus: ["MISSING_FEE%*\\"] }),
      filters,
    };
    assert.equal(await client.fetchDatasetCount(options), 31);
    await client.fetchDatasetPage({
      ...options,
      pageIndex: 1,
      pageSize: 25,
      sort: { column: dataset === "live" ? "source_amount" : "amount", direction: "desc" },
      includeCount: false,
    });
    const { p_limit, p_offset, p_direction, p_order_by, p_include_count, ...pageFilters } =
      requests[1];
    assert.deepEqual(requests[0], pageFilters);
    assert.deepEqual(requests[0].p_search_skus, options.searchValues.skus);
    assert.deepEqual(
      [p_limit, p_offset, p_direction, p_order_by, p_include_count],
      [25, 25, "desc", "amount", false],
    );
  }
});

test("non-transaction counts retain filtered HEAD requests", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/company_payout_reports");
    assert.equal(init.method, "HEAD");
    assert.equal(init.headers.Prefer, "count=exact");
    assert.equal(init.body, undefined);
    assert.equal(new URL(url).searchParams.get("order"), null);
    return new Response(null, { headers: { "Content-Range": "0-0/31" } });
  });
  assert.equal(
    await client.fetchDatasetCount({ ...OPTIONS, dataset: "payouts", search: "USD" }),
    31,
  );
});

test("count validation and failed requests cannot invent zero or expose private errors", async () => {
  for (const value of [12, null, "-1", "1.5", "9007199254740992", {}, undefined]) {
    const client = createApiClient(SETTINGS, async () => new Response(JSON.stringify(value)));
    await assert.rejects(client.fetchDatasetCount(OPTIONS));
  }
  const missing = createApiClient(SETTINGS, async () => new Response(null));
  await assert.rejects(
    missing.fetchDatasetCount({ ...OPTIONS, dataset: "payouts", search: "anything" }),
    /not returned/,
  );
  const forbidden = createApiClient(
    SETTINGS,
    async () => new Response("private SQL details", { status: 403 }),
  );
  await assert.rejects(forbidden.fetchDatasetCount(OPTIONS), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
    assert.equal(error.message.includes("private SQL"), false);
    return true;
  });
  const invalid = createApiClient(SETTINGS, () =>
    assert.fail("Invalid filters must not reach the API"),
  );
  await assert.rejects(
    invalid.fetchDatasetCount({
      ...OPTIONS,
      filters: normalizeDatasetFilters({ dateFrom: "2026-02-30" }),
    }),
  );
});

test("count cancellation reaches the API and preserves abort rather than retryable failure", async () => {
  const controller = new AbortController();
  const aborted = new DOMException("Cancelled", "AbortError");
  const client = createApiClient(SETTINGS, async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    controller.abort();
    throw aborted;
  });
  await assert.rejects(
    client.fetchDatasetCount({ ...OPTIONS, signal: controller.signal }),
    (error) => error === aborted,
  );
});
