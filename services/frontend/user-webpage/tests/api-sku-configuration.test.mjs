import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, ApiError } from "../src/api/client.ts";
import { SkuConfigurationError } from "../src/api/sku-configuration-errors.ts";
import { SETTINGS, responseJson } from "./api-fixtures.mjs";

const ID = "0198b50b-701a-7000-8000-000000000001";
const VERSION = "0198b50b-701a-7000-8000-000000000002";
const NEXT = "0198b50b-701a-7000-8000-000000000003";
const SKU = ' SKU "exact" 한글 ';
const period = {
  marketplace_name: "Amazon.com",
  valid_from: "2026-01-01",
  valid_to: null,
  fee_rate_percent: "5.123456",
};
const issue = {
  sku: SKU,
  kind: "missing_company",
  marketplace_name: null,
  valid_from: null,
  valid_to: null,
};
const item = {
  sku: SKU,
  sku_id: null,
  company_id: null,
  terms_version_id: null,
  periods: [],
  requirements: [],
  issues: [issue],
};
const change = {
  sku: SKU,
  company_id: ID,
  expected_current_version_id: VERSION,
  periods: [period],
};

test("configuration reads preserve exact SKU text and incomplete historical settings", async () => {
  const controller = new AbortController();
  const saved = {
    ...item,
    sku: "Configured",
    sku_id: ID,
    company_id: ID,
    terms_version_id: VERSION,
    periods: [period],
    issues: [],
  };
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/sku_configuration");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {});
    assert.equal(init.signal, controller.signal);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-access");
    return responseJson({ items: [item, saved] });
  });
  assert.deepEqual(await client.fetchSkuConfiguration("test-access", controller.signal), {
    items: [item, saved],
  });
});

test("malformed configuration reads never masquerade as a complete empty configuration", async () => {
  for (const body of [
    {},
    { items: null },
    { items: [item, item] },
    { items: [{ ...item, company_id: ID }] },
    { items: [{ ...item, periods: [{ ...period, fee_rate_percent: 5.123456 }] }] },
    { items: [{ ...item, periods: [{ ...period, valid_from: "2026-02-30" }] }] },
    { items: [{ ...item, issues: [{ ...issue, sku: "another SKU" }] }] },
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(body));
    await assert.rejects(client.fetchSkuConfiguration("test-access"));
  }
});

test("configuration returns every known SKU beyond ordinary REST row limits", async () => {
  let calls = 0;
  const items = Array.from({ length: 1205 }, (_, index) => {
    const sku = `SKU-${String(index)}`;
    return { ...item, sku, issues: [{ ...issue, sku }] };
  });
  const client = createApiClient(SETTINGS, async () => {
    calls += 1;
    return responseJson({ items });
  });
  const result = await client.fetchSkuConfiguration("test-access");
  assert.equal(result.items.length, 1205);
  assert.equal(result.items.at(-1).sku, "SKU-1204");
  assert.equal(calls, 1);
});

test("publishing sends one exact complete batch with CAS and preserves decimal text", async () => {
  let calls = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    calls += 1;
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/publish_sku_configuration");
    assert.deepEqual(JSON.parse(init.body), {
      p_changes: [change],
      p_change_reason: "Correct assignment and fees",
    });
    return responseJson({ published: [{ sku: SKU, terms_version_id: NEXT }], changed_count: 1 });
  });
  assert.deepEqual(
    await client.publishSkuConfiguration({
      accessToken: "test-access",
      changes: [change],
      changeReason: " Correct assignment and fees ",
    }),
    { published: [{ sku: SKU, terms_version_id: NEXT }], changed_count: 1 },
  );
  assert.equal(calls, 1);
});

test("invalid batch inputs fail before any publication request", async () => {
  let calls = 0;
  const client = createApiClient(SETTINGS, async () => {
    calls += 1;
    return responseJson({});
  });
  for (const changes of [
    [],
    [change, change],
    [{ ...change, sku: "  " }],
    [{ ...change, company_id: "invalid" }],
    [{ ...change, expected_current_version_id: "invalid" }],
    [{ ...change, periods: [{ ...period, fee_rate_percent: "100.000001" }] }],
    [{ ...change, periods: [{ ...period, fee_rate_percent: "5.0000000" }] }],
    [{ ...change, periods: [{ ...period, fee_rate_percent: "-1" }] }],
    [{ ...change, periods: [{ ...period, valid_to: period.valid_from }] }],
  ])
    await assert.rejects(client.publishSkuConfiguration({ accessToken: "test-access", changes }));
  assert.equal(calls, 0);
});

test("global gaps and stale edits are safely decoded without losing structured issues", async () => {
  for (const [status, body, kind] of [
    [
      400,
      {
        code: "23514",
        message: "SKU configuration is incomplete",
        details: JSON.stringify({ issues: [issue] }),
      },
      "incomplete",
    ],
    [409, { code: "PT409", message: "SKU configuration changed while editing" }, "conflict"],
    [400, { code: "23514", message: "Invalid SKU configuration" }, "invalid"],
  ]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async () => {
      calls += 1;
      return responseJson(body, status);
    });
    await assert.rejects(
      client.publishSkuConfiguration({ accessToken: "test-access", changes: [change] }),
      (error) =>
        error instanceof SkuConfigurationError &&
        error.kind === kind &&
        (kind !== "incomplete" || assert.deepEqual(error.issues, [issue]) === undefined),
    );
    assert.equal(calls, 1);
  }
});

test("unexpected database errors and malformed issues remain private", async () => {
  for (const body of [
    { code: "23514", message: "private database diagnostic", details: "secret contents" },
    {
      code: "23514",
      message: "SKU configuration is incomplete",
      details: JSON.stringify({ issues: [{ ...issue, kind: "secret diagnostic" }] }),
    },
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(body, 400));
    await assert.rejects(
      client.publishSkuConfiguration({ accessToken: "test-access", changes: [change] }),
      (error) =>
        error instanceof ApiError && error.status === 400 && !/secret|private/.test(error.message),
    );
  }
});

test("uncertain writes require reconciliation and never retry automatically", async () => {
  for (const fetcher of [
    async () => {
      throw new TypeError("private network information");
    },
    async () => responseJson({ message: "private" }, 500),
    async () => responseJson({ published: [], changed_count: 1 }),
    async () =>
      responseJson({ published: [{ sku: "other", terms_version_id: NEXT }], changed_count: 1 }),
  ]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (...args) => {
      calls += 1;
      return fetcher(...args);
    });
    await assert.rejects(
      client.publishSkuConfiguration({ accessToken: "test-access", changes: [change] }),
      (error) =>
        error instanceof SkuConfigurationError &&
        error.kind === "unconfirmed" &&
        /Reload/.test(error.message) &&
        !/private/.test(error.message),
    );
    assert.equal(calls, 1);
  }
});
