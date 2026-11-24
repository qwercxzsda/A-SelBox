import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, ApiError } from "../src/api/client.ts";
import { SETTINGS } from "./api-fixtures.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sku = uuid(1),
  company = uuid(2);
const period = {
  marketplace_name: "Amazon.com",
  valid_from: "2026-01-01",
  valid_to: null,
  fee_rate_percent: "5.123456",
};
function version(n, changes = {}) {
  return {
    id: uuid(100 + n),
    key_id: sku,
    company_id: company,
    version_number: String(n),
    memo: `Version ${n}`,
    fee_period_count: "1",
    created_at: "2026-11-01T12:30:00+00:00",
    periods: [period],
    ...changes,
  };
}

test("each fee history page receives its versions and their exact periods in one request", async () => {
  const versions = Array.from({ length: 12 }, (_, i) => version(12 - i));
  versions[0] = version(12, {
    fee_period_count: "2",
    periods: [
      { ...period, valid_from: "2025-01-01", valid_to: "2026-01-01", fee_rate_percent: "0" },
      period,
    ],
  });
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/sku_configuration_history");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-access");
    const args = JSON.parse(init.body);
    calls.push(args);
    const end = args.p_offset + args.p_limit;
    return Response.json({
      versions: versions.slice(args.p_offset, end),
      has_next: versions.length > end,
    });
  });
  const first = await client.fetchSkuConfigurationHistory("test-access", sku);
  assert.equal(first.hasNext, true);
  assert.deepEqual(
    first.versions.map((v) => v.version_number),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
  assert.deepEqual(first.versions[0].periods, versions[0].periods);
  const last = await client.fetchSkuConfigurationHistory("test-access", sku, 1);
  assert.equal(last.hasNext, false);
  assert.deepEqual(
    last.versions.map((v) => v.version_number),
    [2, 1],
  );
  assert.deepEqual(calls, [
    { p_key_id: sku, p_limit: 10, p_offset: 0 },
    { p_key_id: sku, p_limit: 10, p_offset: 10 },
  ]);
});

test("empty and zero-period saved versions stay distinct", async () => {
  for (const versions of [
    [],
    [version(1, { company_id: null, fee_period_count: "0", memo: "", periods: [] })],
  ]) {
    const client = createApiClient(SETTINGS, async () =>
      Response.json({ versions, has_next: false }),
    );
    const result = await client.fetchSkuConfigurationHistory("access", sku);
    assert.equal(result.versions.length, versions.length);
    if (versions.length) {
      assert.equal(result.versions[0].memo, "");
      assert.deepEqual(result.versions[0].periods, []);
      assert.equal(result.versions[0].company_id, null);
    }
  }
});

test("saved history rejects malformed pages, foreign versions and incomplete or duplicate schedules", async () => {
  const badRows = [
    [version(1, { key_id: uuid(3) })],
    [version(1), version(1)],
    [version(1), version(2)],
    [version(1, { id: "bad" })],
    [version(1, { company_id: "bad" })],
    [version(1, { version_number: "0" })],
    [version(1, { created_at: "invalid" })],
    [version(1, { fee_period_count: "-1" })],
    [version(1, { periods: [] })],
    [version(1, { fee_period_count: "2", periods: [period, period] })],
    ...[
      { valid_from: "2026-02-30" },
      { valid_to: "2025-12-31" },
      { fee_rate_percent: "5.0000001" },
      { fee_rate_percent: "101" },
    ].map((changes) => [version(1, { periods: [{ ...period, ...changes }] })]),
  ];
  for (const bad of [
    null,
    {},
    { versions: [], has_next: true },
    { versions: [version(1)], has_next: "true" },
    { versions: Array.from({ length: 11 }, (_, i) => version(11 - i)), has_next: false },
    ...badRows.map((versions) => ({ versions, has_next: false })),
  ]) {
    const client = createApiClient(SETTINGS, async () => Response.json(bad));
    await assert.rejects(client.fetchSkuConfigurationHistory("access", sku));
  }
});

test("history validates the key, page offset and cancellation before accessing the server", async () => {
  const client = createApiClient(SETTINGS, async () => assert.fail("unexpected history request"));
  await assert.rejects(client.fetchSkuConfigurationHistory("access", "invalid"));
  await assert.rejects(client.fetchSkuConfigurationHistory("access", sku, -1));
  await assert.rejects(client.fetchSkuConfigurationHistory("access", sku, 0, AbortSignal.abort()));
  const denied = createApiClient(
    SETTINGS,
    async () => new Response("private reason", { status: 403 }),
  );
  await assert.rejects(
    denied.fetchSkuConfigurationHistory("access", sku),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      !error.message.includes("private reason"),
  );
});
