import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createTransport } from "../src/api/transport.ts";
import { createAuthApi } from "../src/api/auth.ts";
import { REQUEST_TIMEOUT_MS } from "../src/api/request-deadline.ts";
import { SETTINGS, responseJson } from "./api-fixtures.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stalledBody(status = 200) {
  let controller;
  const started = deferred();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        controller = stream;
        stream.enqueue(new TextEncoder().encode("{"));
      },
    }),
    { status },
  );
  const read = response.text.bind(response);
  response.text = () => {
    started.resolve();
    return read();
  };
  return { response, started: started.promise, close: () => controller.close() };
}

function isTimeout(error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, null);
  assert.match(error.message, /timed out/);
  assert.equal(error.name, "ApiError");
  return true;
}

test("the shared request deadline aborts stalled headers even when fetch ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = deferred();
  let effectiveSignal;
  const transport = createTransport(SETTINGS, (_url, { signal }) => {
    effectiveSignal = signal;
    started.resolve();
    return new Promise(() => {});
  });
  const rejected = assert.rejects(
    transport.requestJson("/auth/v1/user", {}, "Session verification"),
    isTimeout,
  );
  await started.promise;
  t.mock.timers.tick(REQUEST_TIMEOUT_MS);
  await rejected;
  assert.equal(effectiveSignal.aborted, true);
});

test("the deadline covers a stalled response body, using the same budget as its headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const headers = deferred();
  const started = deferred();
  const body = stalledBody();
  let effectiveSignal;
  const transport = createTransport(SETTINGS, async (_url, { signal }) => {
    effectiveSignal = signal;
    started.resolve();
    await headers.promise;
    return body.response;
  });
  let settled = false;
  const rejected = assert.rejects(
    transport.requestJson("/rest/v1/companies", {}, "Companies").finally(() => {
      settled = true;
    }),
    isTimeout,
  );
  await started.promise;
  t.mock.timers.tick(20_000);
  headers.resolve();
  await body.started;
  t.mock.timers.tick(9_999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(effectiveSignal.aborted, true);
  body.close();
});

for (const stage of ["headers", "body"]) {
  test(`caller cancellation while waiting for ${stage} preserves its reason and aborts the underlying request`, async () => {
    const caller = new AbortController();
    const started = deferred();
    const body = stalledBody();
    let effectiveSignal;
    const transport = createTransport(SETTINGS, (_url, { signal }) => {
      effectiveSignal = signal;
      started.resolve();
      return stage === "headers" ? new Promise(() => {}) : Promise.resolve(body.response);
    });
    const reason = new DOMException("User changed the filter", "AbortError");
    const rejected = assert.rejects(
      transport.requestJson("/rest/v1/companies", { signal: caller.signal }, "Companies"),
      (error) => error === reason,
    );
    await started.promise;
    if (stage === "body") await body.started;
    caller.abort(reason);
    await rejected;
    assert.notEqual(effectiveSignal, caller.signal);
    assert.equal(effectiveSignal.aborted, true);
    assert.equal(effectiveSignal.reason, reason);
    body.close();
  });
}

test("already-cancelled work never starts HTTP or converts a caller reason into a network error", async () => {
  const caller = new AbortController();
  const reason = new Error("Caller cancelled");
  caller.abort(reason);
  const transport = createTransport(SETTINGS, () => assert.fail("Cancelled request reached HTTP"));
  await assert.rejects(
    transport.requestJson("/rest/v1/companies", { signal: caller.signal }, "Companies"),
    (error) => error === reason,
  );
});

test("successful completion clears the deadline and caller listener without changing Response metadata", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const caller = new AbortController();
  let effectiveSignal;
  const original = new Response("id\nrow-a\n", {
    status: 206,
    headers: { "Content-Range": "0-0/3", "Content-Type": "text/csv" },
  });
  const transport = createTransport(SETTINGS, async (_url, { signal, redirect }) => {
    assert.equal(redirect, "error");
    effectiveSignal = signal;
    return original;
  });
  const result = await transport.request(
    "/rest/v1/account_directory",
    { signal: caller.signal },
    "Accounts",
    async (response) => {
      assert.equal(response, original);
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("Content-Range"), "0-0/3");
      return response.text();
    },
  );
  assert.equal(result, "id\nrow-a\n");
  t.mock.timers.tick(REQUEST_TIMEOUT_MS);
  caller.abort();
  assert.equal(effectiveSignal.aborted, false);
});

test("HTTP errors cancel unused stalled response bodies and preserve their sanitized status", async () => {
  let cancelled = false;
  const transport = createTransport(
    SETTINGS,
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode("private server error"));
          },
          cancel() {
            cancelled = true;
            return new Promise(() => {});
          },
        }),
        { status: 503 },
      ),
  );
  await assert.rejects(transport.requestJson("/rest/v1/companies", {}, "Companies"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.message.includes("private server error"), false);
    return true;
  });
  assert.equal(cancelled, true);
});

test("CSV downloads and parsed RPC error bodies are also bounded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const kind of ["csv", "rpc-error"]) {
    const body = stalledBody(kind === "rpc-error" ? 400 : 200);
    const transport = createTransport(SETTINGS, async () => body.response, 10);
    const pending =
      kind === "csv"
        ? transport.readCsvPage("token", "account_directory", new URLSearchParams(), "Accounts")
        : transport.postRpc("token", "publish_sku_configuration", {}, "Save fees");
    const rejected = assert.rejects(pending, isTimeout);
    await body.started;
    t.mock.timers.tick(10);
    await rejected;
    body.close();
  }
});

test("a timed-out account mutation is not automatically replayed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = deferred();
  let calls = 0;
  const auth = createAuthApi(
    createTransport(
      SETTINGS,
      () => {
        calls += 1;
        started.resolve();
        return new Promise(() => {});
      },
      10,
    ),
  );
  const rejected = assert.rejects(auth.signUp("user@example.invalid", "test-password"), isTimeout);
  await started.promise;
  t.mock.timers.tick(10);
  await rejected;
  t.mock.timers.tick(REQUEST_TIMEOUT_MS);
  assert.equal(calls, 1);
});

test("JSON decode failures retain their validation error rather than becoming a timeout or network failure", async () => {
  const transport = createTransport(SETTINGS, async () => responseJson("invalid-json"));
  assert.equal(await transport.requestJson("/rest/v1/example", {}, "Example"), "invalid-json");
  const invalid = createTransport(SETTINGS, async () => new Response("{"));
  await assert.rejects(invalid.requestJson("/rest/v1/example", {}, "Example"), (error) => {
    assert.equal(error instanceof ApiError, false);
    assert.match(error.message, /invalid JSON/);
    return true;
  });
});
