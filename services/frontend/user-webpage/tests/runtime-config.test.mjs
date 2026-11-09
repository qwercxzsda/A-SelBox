import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeConfig, validateBuildConfig } from "../src/api/runtime-config.ts";
import { createApiClient } from "../src/api/client.ts";
import { sessionStorageKey } from "../src/session-storage.ts";
import { workspaceStoragePrefix } from "../src/workspace-storage.ts";
import { SESSION, responseJson } from "./api-fixtures.mjs";

const environment = {
  VITE_SUPABASE_URL: "same-origin",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_config_test",
};

test("same-origin resolves each runtime host while absolute API URLs retain their own scope", () => {
  const first = readRuntimeConfig(environment, "https://first.example.invalid");
  const next = readRuntimeConfig(environment, "https://next.example.invalid");
  assert.equal(first.supabaseUrl, "https://first.example.invalid");
  assert.equal(next.supabaseUrl, "https://next.example.invalid");
  assert.notEqual(sessionStorageKey(first.supabaseUrl), sessionStorageKey(next.supabaseUrl));
  assert.notEqual(
    workspaceStoragePrefix(first.supabaseUrl),
    workspaceStoragePrefix(next.supabaseUrl),
  );
  assert.deepEqual(
    readRuntimeConfig(
      {
        VITE_SUPABASE_URL: "https://api.example.invalid///",
        VITE_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_config_test ",
      },
      "https://app.example.invalid",
    ),
    {
      supabaseUrl: "https://api.example.invalid",
      publishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  );
});

test("same-origin is explicit and missing environment values never fall back to the browser", () => {
  for (const invalid of [
    null,
    undefined,
    [],
    {},
    { ...environment, VITE_SUPABASE_URL: undefined },
    { ...environment, VITE_SUPABASE_URL: " " },
    { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: " " },
  ]) {
    assert.throws(
      () => readRuntimeConfig(invalid, "https://app.example.invalid"),
      /must be configured/,
    );
    assert.throws(() => validateBuildConfig(invalid), /must be configured/);
  }
  for (const url of ["/", "SAME-ORIGIN", "same-origin/path"]) {
    assert.throws(() =>
      readRuntimeConfig({ ...environment, VITE_SUPABASE_URL: url }, "https://app.example.invalid"),
    );
    assert.throws(() => validateBuildConfig({ ...environment, VITE_SUPABASE_URL: url }));
  }
});

test("resolved browser origins retain HTTPS, locality, and origin-only validation", () => {
  for (const origin of [
    "http://remote.example.invalid",
    "file:///tmp/app.html",
    "null",
    "//relative.example.invalid",
    "https://user:password@app.example.invalid",
    "https://app.example.invalid/path",
    "https://app.example.invalid/?query=value",
    "https://app.example.invalid/#fragment",
    undefined,
  ])
    assert.throws(() => readRuntimeConfig(environment, origin), /Supabase URL/);
  for (const origin of [
    "http://localhost:4173",
    "http://127.0.0.1:5174",
    "http://[::1]:5173",
    "http://host.docker.internal:4173",
  ])
    assert.equal(readRuntimeConfig(environment, origin).supabaseUrl, origin);
});

test("build validation needs no browser origin and still rejects unsafe URLs and nonpublic keys", () => {
  assert.equal(validateBuildConfig(environment), undefined);
  assert.equal(
    validateBuildConfig({ ...environment, VITE_SUPABASE_URL: "https://api.example.invalid" }),
    undefined,
  );
  assert.throws(
    () =>
      validateBuildConfig({ ...environment, VITE_SUPABASE_URL: "http://remote.example.invalid" }),
    /Supabase URL/,
  );
  const jwt = (role) =>
    `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.doesNotThrow(() =>
    validateBuildConfig({ ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }),
  );
  for (const key of ["sb_secret_config_test", jwt("service_role"), "not-a-public-key"]) {
    const config = { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: key };
    assert.throws(() => validateBuildConfig(config), /publishable key or legacy anon/);
    assert.throws(
      () => readRuntimeConfig(config, "https://app.example.invalid"),
      /publishable key or legacy anon/,
    );
  }
});

test("Auth and REST requests use the resolved runtime origin, never the build validation origin", async () => {
  for (const origin of ["https://first.example.invalid", "https://next.example.invalid"]) {
    const requests = [];
    const client = createApiClient(readRuntimeConfig(environment, origin), async (url, init) => {
      requests.push({ url: new URL(url), headers: new Headers(init.headers) });
      return responseJson(new URL(url).pathname.startsWith("/auth/") ? SESSION : []);
    });
    await client.signIn("member@example.invalid", "synthetic-password");
    await client.fetchCompanies("synthetic-access");
    assert.deepEqual(
      requests.map(({ url }) => url.origin),
      [origin, origin],
    );
    assert.deepEqual(
      requests.map(({ url }) => url.pathname),
      ["/auth/v1/token", "/rest/v1/companies"],
    );
    assert.equal(requests[0].headers.get("apikey"), environment.VITE_SUPABASE_PUBLISHABLE_KEY);
  }
});
