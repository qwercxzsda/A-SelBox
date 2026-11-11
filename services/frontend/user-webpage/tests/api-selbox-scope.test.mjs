import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { createDatasetScope } from "../src/dataset-query-cache.ts";
import { SETTINGS, pageRequest, responseJson } from "./api-fixtures.mjs";

test("summary records and counts exclude SelBox on the server without filtering out the Finances source", async () => {
  const calls = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    calls.push(JSON.parse(init.body));
    return responseJson(
      new URL(url).pathname.endsWith("_count") ? "0" : { rows: [], total_count: "0" },
    );
  });
  for (const includeSelbox of [undefined, false, true]) {
    await client.fetchDatasetPage(pageRequest("live", { includeSelbox }));
    await client.fetchDatasetCount({
      accessToken: "test-access",
      dataset: "live",
      search: "",
      includeSelbox,
    });
  }
  assert.deepEqual(
    calls.map((args) => args.p_include_selbox),
    [undefined, undefined, false, false, true, true],
  );
  for (const args of calls) {
    assert.deepEqual(args.p_sources, []);
    assert.deepEqual(args.p_types, []);
  }
});

test("invalid or unsupported SelBox selections fail before requesting any data", async () => {
  const client = createApiClient(SETTINGS, () =>
    assert.fail("Invalid selections must not reach HTTP"),
  );
  for (const includeSelbox of [null, "false", 0, [], {}]) {
    await assert.rejects(client.fetchDatasetPage(pageRequest("live", { includeSelbox })), /SelBox/);
    await assert.rejects(
      client.fetchDatasetCount({
        accessToken: "test-access",
        dataset: "live",
        search: "",
        includeSelbox,
      }),
      /SelBox/,
    );
  }
  for (const dataset of ["finances", "data_kiosk", "payouts", "accounts"]) {
    await assert.rejects(
      client.fetchDatasetPage(pageRequest(dataset, { includeSelbox: false })),
      /SelBox/,
    );
    await assert.rejects(
      client.fetchDatasetCount({
        accessToken: "test-access",
        dataset,
        search: "",
        includeSelbox: false,
      }),
      /SelBox/,
    );
  }
});

test("company-only record caches cannot reuse main-list pages or counts containing SelBox", () => {
  const identity = {
    session: { user: { id: "user-1" } },
    account: { access_role: "administrator", company_id: null },
    skuOptions: [],
  };
  const options = { dataset: "live", search: "" };
  const all = createDatasetScope(identity, options);
  const explicitAll = createDatasetScope(identity, { ...options, includeSelbox: true });
  const company = createDatasetScope(identity, { ...options, includeSelbox: false });
  assert.deepEqual(all.key, explicitAll.key);
  assert.notDeepEqual(all.key, company.key);
  assert.notDeepEqual(all.countKey, company.countKey);
  assert.equal(all.matches({ queryKey: [...company.key, "date", 25, 0] }), false);
  assert.equal(company.matches({ queryKey: [...all.key, "date", 25, 0] }), false);
});
