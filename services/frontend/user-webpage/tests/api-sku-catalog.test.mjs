import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, responseJson, assertRpcRequest } from "./api-fixtures.mjs";

test("SKU catalog loads every distinct value in one no-argument RPC without a row limit", async () => {
  const expected = Array.from({ length: 10_002 }, (_, i) => `SKU-${String(i).padStart(5, "0")}`);
  const signal = new AbortController().signal;
  let requests = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.deepEqual(assertRpcRequest(assert, url, init, "sku_filter_options"), {});
    assert.equal(init.signal, signal);
    requests += 1;
    return responseJson({ values: expected });
  });
  await assert.rejects(client.fetchSkuOptions(""));
  assert.equal(requests, 0);
  assert.deepEqual(await client.fetchSkuOptions("test-access", signal), expected);
  assert.equal(requests, 1);
});

test("a complete SKU catalog preserves exact text and PostgreSQL Unicode ordering", async () => {
  const options = ["\t", '  SKU,"quote"\\path.(value)  ', "\u2003", "\uE000", "ＳＫＵ－１", "😀"];
  const client = createApiClient(SETTINGS, async () => responseJson({ values: options }));
  assert.deepEqual(await client.fetchSkuOptions("test-access"), options);
  const empty = createApiClient(SETTINGS, async () => responseJson({ values: [] }));
  assert.deepEqual(await empty.fetchSkuOptions("test-access"), []);
});

test("SKU catalogs reject malformed values, duplicates, and unknown fields", async () => {
  for (const payload of [
    null,
    [],
    {},
    { values: "A" },
    { values: [null] },
    { values: [1] },
    { values: [""] },
    { values: ["invalid\0value"] },
    { values: ["A", "A"] },
    { values: ["A"], extra: true },
  ]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () => {
      requests += 1;
      return responseJson(payload);
    });
    await assert.rejects(client.fetchSkuOptions("test-access"));
    assert.equal(requests, 1);
  }
});

test("a denied SKU catalog fails without returning empty choices or falling back to table reads", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.deepEqual(assertRpcRequest(assert, url, init, "sku_filter_options"), {});
    requests += 1;
    return responseJson({ code: "42501", message: "Administrator access required" }, 403);
  });
  await assert.rejects(client.fetchSkuOptions("test-access"), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.message, "SKU options failed with HTTP 403");
    return true;
  });
  assert.equal(requests, 1);
});

test("SKU catalog cancellation aborts its single request with the original reason", async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  let calls = 0;
  const client = createApiClient(SETTINGS, async (_url, { signal }) => {
    assert.equal(signal, controller.signal);
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      started.resolve();
    });
  });
  const pending = client.fetchSkuOptions("test-access", controller.signal);
  const rejected = assert.rejects(pending, (error) => error === controller.signal.reason);
  await started.promise;
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});
