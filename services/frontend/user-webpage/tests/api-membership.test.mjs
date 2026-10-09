import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { parseAppAccount } from "../src/api/workspace.ts";
import { visibleDatasets } from "../src/view-model.ts";
import {
  COMPANY_ID,
  OTHER_COMPANY_ID,
  SETTINGS,
  csvRecord,
  datasetFilters,
  pageRequest,
  responseJson,
} from "./api-fixtures.mjs";

const user_id = "0198b50b-701a-7000-8000-000000000003";
const accessToken = "test-access";
const account = { user_id, access_role: "unassigned", company_id: null };

test("company-filtered account pages and counts share the same company and email scope", async () => {
  const requests = [];
  const member = {
    ...account,
    access_role: "member",
    company_id: COMPANY_ID,
    email: "member@example.test",
    email_confirmed: true,
    created_at: "2026-10-02T00:00:00Z",
  };
  const client = createApiClient(SETTINGS, async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    requests.push({ init, params: searchParams });
    assert.equal(pathname, "/rest/v1/rpc/account_directory");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${accessToken}`);
    assert.equal(init.body, undefined);
    return new Response(init.method === "HEAD" ? null : csvRecord(member), {
      headers: { "Content-Range": "0-0/1", "Content-Type": "text/csv" },
    });
  });
  const options = pageRequest("accounts", {
    search: "member@example.test",
    filters: datasetFilters({ companyIds: [OTHER_COMPANY_ID, COMPANY_ID, COMPANY_ID] }),
    includeCount: false,
  });
  const result = await client.fetchDatasetPage(options);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].company_id, COMPANY_ID);
  assert.equal(result.rows[0].email, member.email);
  assert.equal(await client.fetchDatasetCount(options), 1);
  const [page, count] = requests;
  for (const { params } of requests) {
    assert.equal(params.get("company_id"), `in.(${COMPANY_ID},${OTHER_COMPANY_ID})`);
    assert.ok(params.get("or").includes("email.imatch."));
  }
  assert.equal(page.params.get("or"), count.params.get("or"));
  assert.equal(page.init.method ?? "GET", "GET");
  assert.equal(page.params.get("limit"), "25");
  assert.equal(new Headers(page.init.headers).has("Prefer"), false);
  assert.equal(count.init.method, "HEAD");
  assert.equal(count.params.get("limit"), "0");
  assert.equal(count.params.has("order"), false);
  assert.equal(new Headers(count.init.headers).get("Prefer"), "count=exact");
});

test("account directory omits empty company selections for both pages and counts", async () => {
  let calls = 0;
  const client = createApiClient(SETTINGS, async (url, init) => {
    calls += 1;
    assert.equal(new URL(url).searchParams.has("company_id"), false);
    return new Response(init.method === "HEAD" ? null : "user_id\n", {
      headers: { "Content-Range": "*/0", "Content-Type": "text/csv" },
    });
  });
  for (const filters of [undefined, datasetFilters()]) {
    const options = pageRequest("accounts", { filters });
    assert.deepEqual(await client.fetchDatasetPage(options), { rows: [], totalCount: 0 });
    assert.equal(await client.fetchDatasetCount(options), 0);
  }
  assert.equal(calls, 4);
});

test("account directory rejects malformed company IDs and unrelated filters before HTTP", async () => {
  const client = createApiClient(SETTINGS, () =>
    assert.fail("Invalid account filters must not reach HTTP"),
  );
  for (const filters of [
    { companyIds: [`${COMPANY_ID},or(company_id.is.null)`] },
    { companyIds: [null] },
    { companyIds: [COMPANY_ID], marketplaces: ["Amazon.com"] },
    { companyIds: [COMPANY_ID], skus: ["SKU"] },
    { companyIds: [COMPANY_ID], sources: ["DATA_KIOSK"] },
    { companyIds: [COMPANY_ID], types: ["NET_PRODUCT_SALES"] },
    { companyIds: [COMPANY_ID], dateFrom: "2026-10-01" },
    { companyIds: [COMPANY_ID], feeApplicability: ["applicable"] },
  ]) {
    const options = pageRequest("accounts", { filters: datasetFilters(filters) });
    await assert.rejects(client.fetchDatasetPage(options));
    await assert.rejects(client.fetchDatasetCount(options));
  }
});

test("unassigned accounts have no company, tabs, or metadata-derived privilege", () => {
  assert.deepEqual(
    parseAppAccount({ ...account, user_metadata: { role: "administrator" } }, user_id),
    account,
  );
  assert.deepEqual(visibleDatasets(account), []);
  for (const row of [
    { ...account, company_id: COMPANY_ID },
    { ...account, access_role: "member" },
    { ...account, access_role: "administrator", company_id: COMPANY_ID },
    { ...account, access_role: "unknown" },
    { ...account, access_role: "operator" },
    { ...account, access_role: "company_member", company_id: COMPANY_ID },
  ])
    assert.throws(() => parseAppAccount(row, user_id), /invalid account/);
});

test("membership mutations send only the target and original membership, never a desired role", async () => {
  for (const [original, companyId] of [
    [account, COMPANY_ID],
    [{ ...account, access_role: "member", company_id: COMPANY_ID }, OTHER_COMPANY_ID],
    [{ ...account, access_role: "member", company_id: COMPANY_ID }, null],
  ]) {
    const updated = {
      ...account,
      access_role: companyId ? "member" : "unassigned",
      company_id: companyId,
    };
    const client = createApiClient(SETTINGS, async (url, init) => {
      assert.equal(new URL(url).pathname, "/rest/v1/rpc/set_company_membership");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        target_user_id: user_id,
        target_company_id: companyId,
        expected_access_role: original.access_role,
        expected_company_id: original.company_id,
      });
      return responseJson([{ ...updated, created_at: "2026-10-02T00:00:00Z" }]);
    });
    assert.deepEqual(
      await client.setCompanyMembership({ accessToken, account: original, companyId }),
      updated,
    );
  }
});

test("membership client rejects administrator edits and mismatched server results", async () => {
  let calls = 0;
  const client = createApiClient(SETTINGS, async () => {
    calls += 1;
    return responseJson([{ ...account, access_role: "administrator" }]);
  });
  await assert.rejects(
    client.setCompanyMembership({
      accessToken,
      account: { ...account, access_role: "administrator" },
      companyId: null,
    }),
    /database manager/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    client.setCompanyMembership({ accessToken, account, companyId: COMPANY_ID }),
    /unexpected assignment/,
  );
});

test("membership changes require one complete acknowledgement for the requested user", async () => {
  const updated = { ...account, access_role: "member", company_id: COMPANY_ID };
  for (const result of [
    null,
    updated,
    [],
    [updated, updated],
    [null],
    [{ ...updated, user_id: "another-user" }],
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(result));
    await assert.rejects(
      client.setCompanyMembership({ accessToken, account, companyId: COMPANY_ID }),
    );
  }
});

test("stale membership and permission failures preserve safe HTTP errors", async () => {
  for (const status of [403, 409, 500]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson({ message: "private SQL details" }, status),
    );
    await assert.rejects(
      client.setCompanyMembership({ accessToken, account, companyId: COMPANY_ID }),
      (error) => error.status === status && !error.message.includes("private SQL"),
    );
  }
});
