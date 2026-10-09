import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, SESSION, responseJson } from "./api-fixtures.mjs";

test("email signup sends only credentials and an optional confirmation redirect", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return responseJson({ id: "new-user", email: "new@example.invalid" });
  });
  assert.equal(
    await client.signUp("new@example.invalid", "new-password", "https://app.example.invalid/"),
    null,
  );
  assert.equal(requested.url.pathname, "/auth/v1/signup");
  assert.equal(requested.url.searchParams.get("redirect_to"), "https://app.example.invalid/");
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers.apikey, SETTINGS.publishableKey);
  assert.deepEqual(JSON.parse(requested.init.body), {
    email: "new@example.invalid",
    password: "new-password",
  });
});

test("signup accepts an immediate Auth session when email confirmation is disabled", async () => {
  const client = createApiClient(SETTINGS, async () => responseJson(SESSION));
  assert.deepEqual(await client.signUp("new@example.invalid", "new-password"), SESSION);
});

test("signup rejects malformed success payloads and keeps server error details private", async () => {
  for (const body of [null, {}, { id: 123 }, { access_token: "token" }]) {
    const client = createApiClient(SETTINGS, async () => responseJson(body));
    await assert.rejects(client.signUp("new@example.invalid", "new-password"));
  }
  for (const status of [400, 422, 429, 503]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson({ message: "private account details" }, status),
    );
    await assert.rejects(client.signUp("new@example.invalid", "new-password"), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private account details"), false);
      return true;
    });
  }
});

test("session verification reads the token's user from Auth rather than cached display identity", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url, init });
    return responseJson({
      id: "verified-user",
      email: "verified@example.invalid",
      user_metadata: { role: "administrator" },
    });
  });
  assert.deepEqual(await client.fetchSessionUser("test-access"), {
    id: "verified-user",
    email: "verified@example.invalid",
  });
  assert.equal(requests[0].url, "https://api.example.invalid/auth/v1/user");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-access");
  for (const status of [401, 403, 503]) {
    const rejected = createApiClient(SETTINGS, async () =>
      responseJson({ private: "Do not display" }, status),
    );
    await assert.rejects(rejected.fetchSessionUser("test-access"), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message.includes("Do not display"), false);
      return true;
    });
  }
});

test("client configuration accepts public keys and rejects secret or service-role keys", () => {
  const legacyKey = (role) =>
    ["header", Buffer.from(JSON.stringify({ role })).toString("base64url"), "signature"].join(".");
  for (const publishableKey of [SETTINGS.publishableKey, legacyKey("anon")]) {
    assert.doesNotThrow(() => createApiClient({ ...SETTINGS, publishableKey }));
  }
  for (const publishableKey of [
    "sb_secret_must_not_reach_browser",
    legacyKey("service_role"),
    "",
  ]) {
    assert.throws(
      () => createApiClient({ ...SETTINGS, publishableKey }),
      /publishable key or legacy anon/,
    );
  }
});

test("company and SKU lookups advance by actual returned rows under a smaller server page cap", async () => {
  const rows = [0, 1, 2].map((index) => ({
    id: `identity-${index}`,
    name: `Company ${index}`,
    sku: `SKU_${index}`,
    company_id: "company-a",
    terms_version_id: `version-${index}`,
  }));
  for (const method of ["fetchCompanies", "fetchSkuAssignments"]) {
    const offsets = [];
    const client = createApiClient(SETTINGS, async (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      offsets.push(offset);
      const page = rows.slice(offset, offset + 2);
      return new Response(JSON.stringify(page), {
        status: 206,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `${offset}-${offset + page.length - 1}/3`,
        },
      });
    });
    assert.equal((await client[method]("test-access")).length, 3);
    assert.deepEqual(offsets, [0, 2]);
  }
});

test("sign out revokes only the current session", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return new Response(null, { status: 204 });
  });
  await client.signOut("test-access");
  assert.equal(requested.url.pathname, "/auth/v1/logout");
  assert.equal(requested.url.searchParams.get("scope"), "local");
  assert.equal(new Headers(requested.init.headers).get("Authorization"), "Bearer test-access");
});

test("Auth refresh uses its refresh grant and does not leak HTTP error bodies", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return responseJson(SESSION);
  });
  assert.deepEqual(await client.refreshSession("test-refresh"), SESSION);
  assert.equal(requested.url.searchParams.get("grant_type"), "refresh_token");
  assert.deepEqual(JSON.parse(requested.init.body), { refresh_token: "test-refresh" });
  const failing = createApiClient(SETTINGS, async () =>
    responseJson({ message: "private response detail" }, 401),
  );
  await assert.rejects(
    failing.refreshSession("test-refresh"),
    (error) => /401/.test(error.message) && !error.message.includes("private response detail"),
  );
});

test("identity lookups reject repeated IDs or changing totals and count only the first page", async () => {
  for (const mode of ["repeated", "changed", "incomplete"]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (_url, init) => {
      calls += 1;
      assert.equal(new Headers(init.headers).has("Prefer"), calls === 1);
      const rows =
        mode === "incomplete" && calls === 2
          ? []
          : [
              {
                id: mode === "repeated" ? "company-a" : `company-${calls}`,
                name: "Company",
              },
            ];
      const count = calls === 1 ? "3" : mode === "changed" ? "4" : "*";
      return new Response(JSON.stringify(rows), { headers: { "Content-Range": `*/${count}` } });
    });
    await assert.rejects(
      client.fetchCompanies("token"),
      /did not advance|changed while loading|incomplete page/,
    );
    assert.equal(calls, 2);
  }
});
