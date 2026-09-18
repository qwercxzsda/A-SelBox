import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { createQueryClient } from "../src/query-client.ts";
import { datasetQueryOptions } from "../src/use-dataset-query.ts";
import { normalizeDatasetFilters } from "../src/dataset-filters.ts";

const IDENTITY = {
  session: { user: { id: "user-a" }, access_token: "private-access-token" },
  account: { access_role: "company_member", company_id: "company-a" },
};
const OPTIONS = {
  dataset: "live",
  search: "",
  sort: DATASET_CONFIG.live.defaultSort,
  pageSize: 25,
  pageIndex: 0,
};

test("cached pages are separated by account access and every server-side query option", async () => {
  const client = createQueryClient();
  const base = datasetQueryOptions(IDENTITY, OPTIONS);
  try {
    client.setQueryData(base.queryKey, { rows: [{ id: "company-a-row" }], totalCount: 1 });
    for (const identity of [
      { ...IDENTITY, session: { ...IDENTITY.session, user: { id: "user-b" } } },
      { ...IDENTITY, account: { ...IDENTITY.account, company_id: "company-b" } },
      { ...IDENTITY, account: { ...IDENTITY.account, access_role: "operator" } },
    ]) {
      assert.equal(client.getQueryData(datasetQueryOptions(identity, OPTIONS).queryKey), undefined);
    }
    for (const options of [
      { dataset: "fees" },
      { search: "SKU_100" },
      { sort: { ...OPTIONS.sort, column: "sku" } },
      { sort: { ...OPTIONS.sort, direction: OPTIONS.sort.direction === "asc" ? "desc" : "asc" } },
      { pageSize: 50 },
      { pageIndex: 1 },
      ...[
        { dateFrom: "2026-09-01" },
        { dateTo: "2026-09-30" },
        { skus: ["SKU_100"] },
        { marketplaces: ["Amazon.com"] },
        { sources: ["DATA_KIOSK"] },
        { types: ["PRINCIPAL"] },
      ].map((filters) => ({ filters: { ...normalizeDatasetFilters(), ...filters } })),
    ]) {
      assert.equal(
        client.getQueryData(datasetQueryOptions(IDENTITY, { ...OPTIONS, ...options }).queryKey),
        undefined,
      );
    }
    const renewed = {
      ...IDENTITY,
      session: { ...IDENTITY.session, access_token: "renewed-private-token" },
    };
    assert.deepEqual(datasetQueryOptions(renewed, OPTIONS).queryKey, base.queryKey);
    assert.deepEqual(
      datasetQueryOptions(IDENTITY, { ...OPTIONS, filters: normalizeDatasetFilters() }).queryKey,
      base.queryKey,
    );
    assert.deepEqual(
      datasetQueryOptions(IDENTITY, {
        ...OPTIONS,
        filters: { ...normalizeDatasetFilters(), skus: ["B", "A", "B"] },
      }).queryKey,
      datasetQueryOptions(IDENTITY, {
        ...OPTIONS,
        filters: { ...normalizeDatasetFilters(), skus: ["A", "B"] },
      }).queryKey,
      "Selection order and duplicate values must share the same cached page",
    );
    assert.equal(JSON.stringify(base.queryKey).includes(IDENTITY.session.access_token), false);
    const fresh = await client.fetchQuery({
      ...base,
      queryFn: () => assert.fail("A fresh cached page must not be fetched again"),
    });
    assert.equal(fresh.rows[0].id, "company-a-row");
    client.clear();
    assert.equal(client.getQueryData(base.queryKey), undefined);
  } finally {
    client.clear();
  }
});

test("only network and server failures receive one retry", async () => {
  const client = createQueryClient();
  try {
    for (const [error, expectedAttempts] of [
      [new ApiError("query", null), 2],
      [new ApiError("query", 503), 2],
      [new ApiError("query", 401), 1],
      [new ApiError("query", 403), 1],
      [new ApiError("query", 400), 1],
      [new Error("Invalid CSV"), 1],
      [new DOMException("Cancelled", "AbortError"), 1],
    ]) {
      let attempts = 0;
      await assert.rejects(
        client.fetchQuery({
          queryKey: [error.message],
          retryDelay: 0,
          queryFn: () => {
            attempts += 1;
            throw error;
          },
        }),
        (thrown) => thrown === error,
      );
      assert.equal(attempts, expectedAttempts, error.message);
    }
  } finally {
    client.clear();
  }
});

test("an out-of-range page invalidates outdated sibling pages before pagination clamps", async () => {
  const client = createQueryClient();
  let requests = 0;
  const api = createApiClient(
    {
      supabaseUrl: "https://api.example.invalid",
      publishableKey: "sb_publishable_query_test_key",
    },
    async (url) => {
      requests += 1;
      const offset = new URL(url).searchParams.get("offset");
      return new Response("", {
        status: offset === "25" ? 416 : 200,
        headers: { "Content-Range": "*/10" },
      });
    },
  );
  const first = datasetQueryOptions(IDENTITY, OPTIONS, api.fetchDatasetPage);
  const second = datasetQueryOptions(IDENTITY, { ...OPTIONS, pageIndex: 1 }, api.fetchDatasetPage);
  const unaffected = [
    datasetQueryOptions(IDENTITY, { ...OPTIONS, search: "different-search" }),
    datasetQueryOptions(IDENTITY, { ...OPTIONS, dataset: "settlement" }),
    datasetQueryOptions(IDENTITY, {
      ...OPTIONS,
      filters: { ...normalizeDatasetFilters(), sources: ["DATA_KIOSK"] },
    }),
    datasetQueryOptions(
      { ...IDENTITY, account: { ...IDENTITY.account, company_id: "company-b" } },
      OPTIONS,
    ),
  ];
  try {
    client.setQueryData(first.queryKey, { rows: [{ id: "old-row" }], totalCount: 26 });
    for (const options of unaffected) {
      client.setQueryData(options.queryKey, { rows: [], totalCount: 26 });
    }
    assert.equal(client.getQueryState(first.queryKey).isInvalidated, false);
    assert.deepEqual(await client.fetchQuery(second), { rows: [], totalCount: 10 });
    assert.equal(requests, 1, "Invalidation must not trigger a recursive request");
    assert.equal(client.getQueryState(first.queryKey).isInvalidated, true);
    for (const options of unaffected) {
      assert.equal(client.getQueryState(options.queryKey).isInvalidated, false);
    }
    assert.deepEqual(await client.fetchQuery(first), { rows: [], totalCount: 10 });
    assert.equal(requests, 2, "Clamped navigation must fetch the invalidated first page");
    assert.equal(client.getQueryState(second.queryKey).isInvalidated, false);
  } finally {
    client.clear();
  }
});
