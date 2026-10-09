import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { CompanyDeletionBlockedError } from "../src/api/company-errors.ts";
import { SETTINGS, responseJson } from "./api-fixtures.mjs";

const COMPANY = { id: "0194e7de-9400-7000-8000-000000000123", name: "New Company" };

test("company creation trims the name and sends only an authenticated creation request", async () => {
  let requested;
  const client = createApiClient(SETTINGS, async (url, init) => {
    requested = { url: new URL(url), init };
    return responseJson([{ ...COMPANY, created: true }]);
  });
  assert.deepEqual(await client.createCompany("user-access", "  New Company  "), {
    ...COMPANY,
    created: true,
  });
  assert.equal(requested.url.pathname, "/rest/v1/rpc/create_company");
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers.Authorization, "Bearer user-access");
  assert.deepEqual(JSON.parse(requested.init.body), { company_name: "New Company" });
});

test("an existing company is returned with its server name and ID rather than duplicated locally", async () => {
  const client = createApiClient(SETTINGS, async () =>
    responseJson([{ ...COMPANY, created: false }]),
  );
  assert.deepEqual(await client.createCompany("user-access", "new company"), {
    ...COMPANY,
    created: false,
  });
  // Existing database names may retain padding beyond the new-name input limit.
  const canonical = { ...COMPANY, name: `  ${COMPANY.name}${" ".repeat(200)}`, created: false };
  const existing = createApiClient(SETTINGS, async () => responseJson([canonical]));
  assert.deepEqual(await existing.createCompany("user-access", "new company"), canonical);
});

test("invalid names fail before HTTP while the 200-character limit matches PostgreSQL Unicode characters", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async (_url, init) => {
    requests += 1;
    return responseJson([{ ...COMPANY, name: JSON.parse(init.body).company_name, created: true }]);
  });
  for (const name of ["", " \t\n ", "x".repeat(201), "🛒".repeat(201), "bad\0name", null]) {
    await assert.rejects(client.createCompany("user-access", name), /1 to 200 characters/);
  }
  assert.equal(requests, 0);
  const unicode = "🛒".repeat(200);
  assert.equal((await client.createCompany("user-access", unicode)).name, unicode);
  assert.equal(requests, 1);
});

test("company creation rejects malformed results instead of showing a false success", async () => {
  for (const response of [
    null,
    [],
    [COMPANY],
    [{ ...COMPANY, id: "invalid", created: true }],
    [{ ...COMPANY, name: " ", created: true }],
    [{ ...COMPANY, name: "bad\0name", created: true }],
    [{ ...COMPANY, created: "true" }],
    [
      { ...COMPANY, created: true },
      { ...COMPANY, created: false },
    ],
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(response));
    await assert.rejects(client.createCompany("user-access", "New Company"));
  }
});

test("failed company mutations stay private and are never automatically replayed", async () => {
  for (const status of [400, 403, 409, 503, null]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () => {
      requests += 1;
      if (status === null) throw new Error("private network detail");
      return responseJson({ message: "private database detail" }, status);
    });
    await assert.rejects(client.createCompany("user-access", "New Company"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test("company deletion sends an authenticated ID and accepts an already removed company", async () => {
  for (const deleted of [true, false]) {
    let requested;
    const result = { id: COMPANY.id, deleted };
    const client = createApiClient(SETTINGS, async (url, init) => {
      requested = { url: new URL(url), init };
      return responseJson([result]);
    });
    assert.deepEqual(await client.deleteCompany("user-access", COMPANY.id), result);
    assert.equal(requested.url.pathname, "/rest/v1/rpc/delete_company");
    assert.equal(requested.init.method, "POST");
    assert.equal(requested.init.headers.Authorization, "Bearer user-access");
    assert.deepEqual(JSON.parse(requested.init.body), { target_company_id: COMPANY.id });
  }
});

test("company deletion rejects invalid IDs before requesting and invalid acknowledgements", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return responseJson([]);
  });
  for (const id of [null, "", "company", "not-a-uuid"])
    await assert.rejects(client.deleteCompany("user-access", id), /valid company ID/);
  assert.equal(requests, 0);
  for (const body of [
    null,
    [],
    [{ id: COMPANY.id }],
    [{ id: COMPANY.id, deleted: "true" }],
    [{ id: "0194e7de-9400-7000-8000-000000000124", deleted: true }],
    [{ id: "invalid", deleted: true }],
    [
      { id: COMPANY.id, deleted: true },
      { id: COMPANY.id, deleted: false },
    ],
  ]) {
    const malformed = createApiClient(SETTINGS, async () => responseJson(body));
    await assert.rejects(malformed.deleteCompany("user-access", COMPANY.id));
  }
});

const BLOCKED_BODY = {
  code: "PT409",
  message: "Company cannot be deleted while it has linked records",
  details: JSON.stringify([
    { code: "members", count: 2 },
    { code: "assigned_skus", count: 10 },
    { code: "terms_versions", count: 99 },
    { code: "payout_reports", count: 4 },
    { code: "payout_refreshes", count: 3 },
    { code: "other_records", count: 1 },
  ]),
};

test("company deletion exposes only validated linked-record reasons and never retries", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return responseJson(BLOCKED_BODY, 409);
  });
  await assert.rejects(client.deleteCompany("user-access", COMPANY.id), (error) => {
    assert.ok(error instanceof CompanyDeletionBlockedError);
    assert.deepEqual(error.reasons, JSON.parse(BLOCKED_BODY.details));
    return true;
  });
  assert.equal(requests, 1);
});

test("malformed deletion reasons and unexpected server messages remain private", async () => {
  const malformedReasons = [
    null,
    [],
    {},
    [{ code: "members", count: "1" }],
    [{ code: "members", count: 0 }],
    [{ code: "members", count: -1 }],
    [{ code: "members", count: 1.5 }],
    [{ code: "members", count: Number.MAX_SAFE_INTEGER + 1 }],
    [{ code: "private", count: 1 }],
    [
      { code: "members", count: 1 },
      { code: "members", count: 2 },
    ],
  ];
  const responses = [
    ...malformedReasons.map((details) => ({ ...BLOCKED_BODY, details: JSON.stringify(details) })),
    { ...BLOCKED_BODY, details: "private malformed JSON" },
    { ...BLOCKED_BODY, details: JSON.parse(BLOCKED_BODY.details) },
    { ...BLOCKED_BODY, code: "23503" },
    { ...BLOCKED_BODY, message: "private database failure" },
  ];
  for (const body of responses) {
    const client = createApiClient(SETTINGS, async () => responseJson(body, 409));
    await assert.rejects(client.deleteCompany("user-access", COMPANY.id), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
  const wrongStatus = createApiClient(SETTINGS, async () => responseJson(BLOCKED_BODY, 400));
  await assert.rejects(wrongStatus.deleteCompany("user-access", COMPANY.id), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    return true;
  });
});

test("deletion transport failures and access denials never remove or automatically retry", async () => {
  for (const status of [400, 403, 503, null]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () => {
      requests += 1;
      if (status === null) throw new Error("private network detail");
      return responseJson({ message: "private database detail" }, status);
    });
    await assert.rejects(client.deleteCompany("user-access", COMPANY.id), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
    assert.equal(requests, 1);
  }
});
