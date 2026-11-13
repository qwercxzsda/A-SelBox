import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, ApiError } from "../src/api/client.ts";
import { SETTINGS } from "./api-fixtures.mjs";

const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const SKU_ID = uuid(1);
const COMPANY_ID = uuid(2);
const VERSION_COLUMNS = [
  "id",
  "sku_id",
  "company_id",
  "version_number",
  "change_reason",
  "fee_period_count",
  "created_at",
];
const PERIOD_COLUMNS = [
  "id",
  "terms_version_id",
  "marketplace_name",
  "valid_period",
  "fee_rate_percent",
];
const version = (number, overrides = {}) => ({
  id: uuid(100 + number),
  sku_id: SKU_ID,
  company_id: COMPANY_ID,
  version_number: String(number),
  change_reason: `Version ${number}`,
  fee_period_count: "1",
  created_at: "2026-11-01T12:30:00+00:00",
  ...overrides,
});
const period = (number, overrides = {}) => ({
  id: uuid(1000 + number),
  terms_version_id: uuid(100 + number),
  marketplace_name: "Amazon.com",
  valid_period: "[2026-01-01,)",
  fee_rate_percent: "5.123456",
  ...overrides,
});

function csvResponse(columns, rows, status = 200) {
  const cell = (value) => (value === null ? "" : `"${String(value).replaceAll('"', '""')}"`);
  return new Response(
    [columns.join(","), ...rows.map((row) => columns.map((key) => cell(row[key])).join(","))].join(
      "\n",
    ),
    {
      status,
      headers: { "Content-Type": "text/csv" },
    },
  );
}

function clientFixture(versions, periods, { cap = 1000, inspect = () => {} } = {}) {
  return createApiClient(SETTINGS, async (rawUrl, init) => {
    const url = new URL(rawUrl);
    inspect(url, init);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-access");
    assert.equal(new Headers(init.headers).get("Accept"), "text/csv");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Math.min(Number(url.searchParams.get("limit")), cap);
    if (url.pathname.endsWith("/sku_terms_versions")) {
      assert.equal(url.searchParams.get("sku_id"), `eq.${SKU_ID}`);
      assert.equal(url.searchParams.get("order"), "version_number.desc,id.desc");
      return csvResponse(VERSION_COLUMNS, versions.slice(offset, offset + limit));
    }
    assert.equal(url.pathname, "/rest/v1/sku_fee_periods");
    const ids = url.searchParams.get("terms_version_id").slice(4, -1).split(",");
    const matches = periods.filter((row) => ids.includes(row.terms_version_id));
    return csvResponse(PERIOD_COLUMNS, matches.slice(offset, offset + limit));
  });
}

test("saved fee history fills small server pages and loads complete exact-rate periods only for displayed versions", async () => {
  const versions = Array.from({ length: 12 }, (_, index) => version(12 - index));
  versions[0].fee_period_count = "2";
  const periods = versions.map((row) => period(Number(row.version_number)));
  periods.unshift(
    period(99, {
      terms_version_id: versions[0].id,
      valid_period: "[2025-01-01,2026-01-01)",
      fee_rate_percent: "0",
    }),
  );
  const requests = [];
  const client = clientFixture(versions, periods, { cap: 2, inspect: (url) => requests.push(url) });
  const first = await client.fetchSkuConfigurationHistory("test-access", SKU_ID);
  assert.equal(first.hasNext, true);
  assert.deepEqual(
    first.versions.map((row) => row.version_number),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
  assert.deepEqual(
    first.versions[0].periods.map((row) => [row.fee_rate_percent, row.valid_from, row.valid_to]),
    [
      ["0", "2025-01-01", "2026-01-01"],
      ["5.123456", "2026-01-01", null],
    ],
  );
  for (const request of requests.filter((url) => url.pathname.endsWith("/sku_fee_periods"))) {
    assert.equal(request.searchParams.get("terms_version_id").includes(version(2).id), false);
    assert.equal(request.searchParams.get("terms_version_id").includes(version(1).id), false);
  }
  const second = await client.fetchSkuConfigurationHistory("test-access", SKU_ID, 1);
  assert.equal(second.hasNext, false);
  assert.deepEqual(
    second.versions.map((row) => row.version_number),
    [2, 1],
  );
});

test("empty and zero-period saved versions stay distinct without inventing fee periods", async () => {
  let requests = 0;
  const empty = clientFixture([], [], {
    inspect: () => {
      requests++;
    },
  });
  assert.deepEqual(await empty.fetchSkuConfigurationHistory("test-access", SKU_ID), {
    versions: [],
    hasNext: false,
  });
  assert.equal(requests, 1);
  const client = clientFixture(
    [version(1, { company_id: null, fee_period_count: "0", change_reason: "" })],
    [],
  );
  const result = await client.fetchSkuConfigurationHistory("test-access", SKU_ID);
  assert.equal(result.versions[0].company_id, null);
  assert.deepEqual(result.versions[0].periods, []);
  assert.equal(result.versions[0].change_reason, "");
});

test("saved fee history rejects cross-SKU versions, duplicate pages and malformed version metadata", async () => {
  for (const versions of [
    [version(1, { sku_id: uuid(9) })],
    [version(1), version(1)],
    [version(1), version(2)],
    [version(1, { id: "bad" })],
    [version(1, { company_id: "bad" })],
    [version(1, { version_number: "0" })],
    [version(1, { fee_period_count: "-1" })],
    [version(1, { created_at: "not-a-date" })],
  ]) {
    await assert.rejects(
      clientFixture(versions, [period(1)]).fetchSkuConfigurationHistory("test-access", SKU_ID),
    );
  }
  const repeating = createApiClient(SETTINGS, async () =>
    csvResponse(VERSION_COLUMNS, [version(1)]),
  );
  await assert.rejects(
    repeating.fetchSkuConfigurationHistory("test-access", SKU_ID),
    /changed while loading/,
  );
});

test("saved fee history rejects incomplete, duplicate or foreign periods and invalid rate/date ranges", async () => {
  for (const periods of [
    [],
    [period(1), period(1)],
    [period(1, { valid_period: "(2026-01-01,)" })],
    [period(1, { valid_period: "[2026-02-30,)" })],
    [period(1, { valid_period: "[2026-02-01,2026-01-01)" })],
    [period(1, { fee_rate_percent: "5.1234567" })],
    [period(1, { fee_rate_percent: "101" })],
  ]) {
    await assert.rejects(
      clientFixture([version(1)], periods).fetchSkuConfigurationHistory("test-access", SKU_ID),
    );
  }
  let versionRead = false;
  const foreign = createApiClient(SETTINGS, async (url) => {
    if (new URL(url).pathname.endsWith("/sku_terms_versions")) {
      const rows = versionRead ? [] : [version(1)];
      versionRead = true;
      return csvResponse(VERSION_COLUMNS, rows);
    }
    return csvResponse(PERIOD_COLUMNS, [period(2)]);
  });
  await assert.rejects(
    foreign.fetchSkuConfigurationHistory("test-access", SKU_ID),
    /another version/,
  );
});

test("saved fee history validates input and respects cancellation and denied reads", async () => {
  let requests = 0;
  const client = clientFixture([], [], {
    inspect: () => {
      requests++;
    },
  });
  await assert.rejects(client.fetchSkuConfigurationHistory("test-access", "invalid"));
  await assert.rejects(client.fetchSkuConfigurationHistory("test-access", SKU_ID, -1));
  const cancelled = new AbortController();
  cancelled.abort(new Error("cancelled"));
  await assert.rejects(
    client.fetchSkuConfigurationHistory("test-access", SKU_ID, 0, cancelled.signal),
    /cancelled/,
  );
  assert.equal(requests, 0);
  const denied = createApiClient(
    SETTINGS,
    async () => new Response("private reason", { status: 403 }),
  );
  await assert.rejects(
    denied.fetchSkuConfigurationHistory("test-access", SKU_ID),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      !error.message.includes("private reason"),
  );
});
