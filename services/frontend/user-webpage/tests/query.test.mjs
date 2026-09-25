import assert from "node:assert/strict";
import test from "node:test";
import { QueryObserver } from "@tanstack/react-query";
import { ApiError } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { createQueryClient } from "../src/query-client.ts";
import { datasetCountQueryOptions, datasetQueryOptions } from "../src/dataset-queries.ts";
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
        { companyIds: ["11111111-1111-4111-8111-111111111111"] },
        { skus: ["SKU_100"] },
        { marketplaces: ["Amazon.com"] },
        { sources: ["DATA_KIOSK"] },
        { types: ["PRINCIPAL"] },
        { feeApplicability: ["applicable"] },
        { feeApplicability: ["not_applicable"] },
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
    assert.deepEqual(
      datasetQueryOptions(IDENTITY, {
        ...OPTIONS,
        filters: {
          ...normalizeDatasetFilters(),
          companyIds: ["company-b", "company-a", "company-b"],
        },
      }).queryKey,
      datasetQueryOptions(IDENTITY, {
        ...OPTIONS,
        filters: { ...normalizeDatasetFilters(), companyIds: ["company-a", "company-b"] },
      }).queryKey,
      "Company selection order and duplicates must share a cache scope",
    );
    assert.equal(JSON.stringify(base.queryKey).includes(IDENTITY.session.access_token), false);
    const fresh = await client.query({
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
        client.query({
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

const countOptions = (overrides = {}, fetchCount = async () => 75) =>
  datasetCountQueryOptions(IDENTITY, { ...OPTIONS, ...overrides }, fetchCount);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("rows return without requesting or awaiting an exact count", async () => {
  const client = createQueryClient();
  const pending = deferred();
  const requests = [];
  try {
    const result = await client.query(
      datasetQueryOptions(IDENTITY, OPTIONS, async (request) => {
        requests.push(request);
        return { rows: [{ id: "ready-row" }], totalCount: null };
      }),
    );
    const count = client.query(countOptions({}, () => pending.promise));
    assert.deepEqual(result, { rows: [{ id: "ready-row" }], totalCount: null });
    assert.equal(requests[0].includeCount, false);
    assert.equal(client.getQueryData(countOptions().queryKey), undefined);
    pending.resolve(75);
    assert.equal(await count, 75);
  } finally {
    pending.resolve(75);
    client.clear();
  }
});

test("financial counts are shared across pages and ordering until an explicit revision invalidation", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const client = createQueryClient();
  let requests = 0;
  const fetchCount = async () => {
    requests += 1;
    return 75;
  };
  try {
    const first = countOptions({}, fetchCount);
    assert.equal(first.staleTime, Infinity);
    assert.equal(await client.query(first), 75);
    now += 60_000;
    for (const options of [
      { pageIndex: 1 },
      { pageSize: 50 },
      { sort: { column: "source_amount", direction: "asc" } },
    ]) {
      const count = countOptions(options, fetchCount);
      assert.deepEqual(count.queryKey, first.queryKey);
      assert.equal(await client.query(count), 75);
    }
    assert.equal(requests, 1);
    await client.invalidateQueries({ queryKey: first.queryKey, exact: true, refetchType: "none" });
    await client.query(first);
    assert.equal(requests, 2);
  } finally {
    client.clear();
  }
});

test("count caches require the exact account, dataset, search, and normalized filter scope", async () => {
  const client = createQueryClient();
  const original = countOptions();
  try {
    client.setQueryData(original.queryKey, 75);
    const distinct = [
      [{ ...IDENTITY, session: { ...IDENTITY.session, user: { id: "user-b" } } }, OPTIONS],
      [{ ...IDENTITY, account: { ...IDENTITY.account, company_id: "company-b" } }, OPTIONS],
      [{ ...IDENTITY, account: { ...IDENTITY.account, access_role: "operator" } }, OPTIONS],
      [IDENTITY, { ...OPTIONS, dataset: "settlement" }],
      [IDENTITY, { ...OPTIONS, search: "SKU_100" }],
      ...[
        { dateFrom: "2026-09-01" },
        { dateTo: "2026-09-30" },
        { companyIds: ["company-a"] },
        { skus: ["A"] },
        { marketplaces: ["Amazon.com"] },
        { sources: ["SETTLEMENT"] },
        { types: ["PRINCIPAL"] },
        { feeApplicability: ["applicable"] },
        { feeApplicability: ["not_applicable"] },
      ].map((filters) => [IDENTITY, { ...OPTIONS, filters }]),
    ];
    for (const [identity, options] of distinct) {
      assert.equal(
        client.getQueryData(datasetCountQueryOptions(identity, options).queryKey),
        undefined,
      );
    }
    assert.deepEqual(
      countOptions({ filters: { skus: ["B", "A", "B"] } }).queryKey,
      countOptions({ filters: { skus: ["A", "B"] } }).queryKey,
    );
    const renewed = { ...IDENTITY, session: { ...IDENTITY.session, access_token: "new-token" } };
    assert.deepEqual(datasetCountQueryOptions(renewed, OPTIONS).queryKey, original.queryKey);
    assert.equal(JSON.stringify(original.queryKey).includes(IDENTITY.session.access_token), false);
  } finally {
    client.clear();
  }
});

test("administrative counts expire after 30 seconds because source revisions do not cover them", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const client = createQueryClient();
  try {
    for (const dataset of ["accounts", "payouts"]) {
      let requests = 0;
      const options = countOptions({ dataset }, async () => ++requests);
      assert.equal(options.staleTime, 30_000);
      assert.equal(await client.query(options), 1);
      now += 29_999;
      assert.equal(await client.query(options), 1);
      now += 1;
      assert.equal(await client.query(options), 2);
    }
  } finally {
    client.clear();
  }
});

test("a changed count invalidates only pages in its exact scope before navigation clamps", async () => {
  const client = createQueryClient();
  const first = datasetQueryOptions(IDENTITY, OPTIONS);
  const second = datasetQueryOptions(IDENTITY, { ...OPTIONS, pageIndex: 1 });
  const unaffected = [
    datasetQueryOptions(IDENTITY, { ...OPTIONS, search: "different-search" }),
    datasetQueryOptions(IDENTITY, { ...OPTIONS, dataset: "settlement" }),
    datasetQueryOptions(IDENTITY, { ...OPTIONS, filters: { sources: ["DATA_KIOSK"] } }),
    datasetQueryOptions(
      { ...IDENTITY, account: { ...IDENTITY.account, company_id: "company-b" } },
      OPTIONS,
    ),
  ];
  try {
    client.setQueryData(countOptions().queryKey, 50);
    for (const options of [first, second, ...unaffected]) {
      client.setQueryData(options.queryKey, { rows: [{ id: "old-row" }], totalCount: null });
    }
    await client.invalidateQueries({
      queryKey: countOptions().queryKey,
      exact: true,
      refetchType: "none",
    });
    assert.equal(await client.query(countOptions({}, async () => 10)), 10);
    assert.equal(client.getQueryState(first.queryKey).isInvalidated, true);
    assert.equal(client.getQueryState(second.queryKey).isInvalidated, true);
    for (const options of unaffected)
      assert.equal(client.getQueryState(options.queryKey).isInvalidated, false);
  } finally {
    client.clear();
  }
});

for (const result of ["empty", "416"]) {
  test(`a ${result} page returns immediately and independently invalidates its cached count`, async () => {
    const client = createQueryClient();
    let requests = 0;
    const count = countOptions();
    try {
      client.setQueryData(count.queryKey, 50);
      const page = datasetQueryOptions(
        IDENTITY,
        { ...OPTIONS, pageIndex: 1 },
        async ({ includeCount }) => {
          requests += 1;
          assert.equal(includeCount, false);
          if (result === "416") throw new ApiError("Transactions", 416);
          return { rows: [], totalCount: null };
        },
      );
      assert.deepEqual(await client.query(page), { rows: [], totalCount: null });
      assert.equal(requests, 1, "Rows must not wait for a counted recovery request");
      assert.equal(client.getQueryState(count.queryKey).isInvalidated, true);
      assert.equal(await client.query(countOptions({}, async () => 10)), 10);
    } finally {
      client.clear();
    }
  });
}

test("a count failure does not discard cached rows, and retrying it does not request rows", async () => {
  const client = createQueryClient();
  let rowRequests = 0;
  const page = datasetQueryOptions(IDENTITY, OPTIONS, async () => {
    rowRequests += 1;
    return { rows: [{ id: "ready-row" }], totalCount: null };
  });
  try {
    await client.query(page);
    await assert.rejects(
      client.query(
        countOptions({}, async () => {
          throw new ApiError("count", 403);
        }),
      ),
    );
    assert.equal(client.getQueryData(page.queryKey).rows[0].id, "ready-row");
    assert.equal(await client.query(countOptions({}, async () => 75)), 75);
    assert.equal(rowRequests, 1);
  } finally {
    client.clear();
  }
});

test("cancelled old count responses cannot replace a newer scope or restore invalidated cache state", async () => {
  const client = createQueryClient();
  const release = deferred();
  const started = deferred();
  const old = countOptions({}, async () => {
    started.resolve();
    return release.promise;
  });
  try {
    const pending = client.query(old).catch(() => undefined);
    await started.promise;
    await client.cancelQueries({ queryKey: old.queryKey, exact: true });
    const current = countOptions({ filters: { skus: ["A"] } }, async () => 5);
    assert.equal(await client.query(current), 5);
    release.resolve(75);
    await pending;
    assert.equal(client.getQueryData(old.queryKey), undefined);
    assert.equal(client.getQueryData(current.queryKey), 5);
  } finally {
    release.resolve(75);
    client.clear();
  }
});

test("a server count supplied with an uncounted page updates the shared count without another request", async () => {
  const client = createQueryClient();
  try {
    client.setQueryData(countOptions().queryKey, 50);
    const response = { rows: [], totalCount: 10 };
    const page = datasetQueryOptions(IDENTITY, { ...OPTIONS, pageIndex: 1 }, async () => response);
    assert.deepEqual(await client.query(page), response);
    assert.equal(client.getQueryData(countOptions().queryKey), 10);
  } finally {
    client.clear();
  }
});

test("a vanished page cancels an older count before requesting its new bound", async () => {
  const client = createQueryClient();
  const started = deferred();
  const release = deferred();
  const count = countOptions({}, async () => {
    started.resolve();
    return release.promise;
  });
  try {
    const pending = client.query(count).catch(() => undefined);
    await started.promise;
    await client.query(
      datasetQueryOptions(IDENTITY, { ...OPTIONS, pageIndex: 1 }, async () => ({
        rows: [],
        totalCount: null,
      })),
    );
    assert.equal(client.getQueryState(count.queryKey).isInvalidated, true);
    assert.equal(await client.query(countOptions({}, async () => 10)), 10);
    release.resolve(50);
    await pending;
    assert.equal(client.getQueryData(count.queryKey), 10);
  } finally {
    release.resolve(50);
    client.clear();
  }
});

test("rows proving that a cached count is too small invalidate that count", async () => {
  const client = createQueryClient();
  const count = countOptions();
  try {
    client.setQueryData(count.queryKey, 1);
    await client.query(
      datasetQueryOptions(IDENTITY, OPTIONS, async () => ({
        rows: [{ id: "first" }, { id: "second" }],
        totalCount: null,
      })),
    );
    assert.equal(client.getQueryState(count.queryKey).isInvalidated, true);
  } finally {
    client.clear();
  }
});

test("a cancelled page cannot publish a late server-supplied count", async () => {
  const client = createQueryClient();
  const started = deferred();
  const release = deferred();
  const page = datasetQueryOptions(IDENTITY, OPTIONS, async () => {
    started.resolve();
    return release.promise;
  });
  try {
    const pending = client.query(page).catch(() => undefined);
    await started.promise;
    await client.cancelQueries({ queryKey: page.queryKey, exact: true });
    client.setQueryData(countOptions().queryKey, 75);
    release.resolve({ rows: [], totalCount: 10 });
    await pending;
    assert.equal(client.getQueryData(countOptions().queryKey), 75);
  } finally {
    release.resolve({ rows: [], totalCount: 10 });
    client.clear();
  }
});

test("a first count refreshes an inconsistent active page even when its page index remains valid", async () => {
  const client = createQueryClient();
  const refreshed = deferred();
  let requests = 0;
  const page = datasetQueryOptions(IDENTITY, OPTIONS, async () => {
    requests += 1;
    return { rows: [{ id: "only-current-row" }], totalCount: null };
  });
  const observer = new QueryObserver(client, {
    ...page,
    initialData: { rows: [{ id: "old-first" }, { id: "old-second" }], totalCount: null },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data?.rows[0]?.id === "only-current-row") refreshed.resolve();
  });
  try {
    assert.equal(await client.query(countOptions({}, async () => 1)), 1);
    await refreshed.promise;
    assert.equal(requests, 1);
    assert.equal(client.getQueryData(page.queryKey).rows.length, 1);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("duplicate fee selections reuse page and count caches without mixing applicability", () => {
  for (const optionsFor of [datasetQueryOptions, datasetCountQueryOptions]) {
    const keyFor = (feeApplicability) =>
      optionsFor(IDENTITY, {
        ...OPTIONS,
        filters: normalizeDatasetFilters({ feeApplicability }),
      }).queryKey;
    assert.deepEqual(keyFor(["applicable", "applicable"]), keyFor(["applicable"]));
    assert.notDeepEqual(keyFor(["applicable"]), keyFor(["not_applicable"]));
    assert.notDeepEqual(keyFor(["applicable"]), keyFor([]));
    assert.deepEqual(
      keyFor(["applicable", "not_applicable"]),
      keyFor(["not_applicable", "applicable"]),
    );
  }
});
