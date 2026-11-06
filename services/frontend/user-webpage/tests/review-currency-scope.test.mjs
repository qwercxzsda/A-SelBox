import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { datasetCountQueryOptions, datasetQueryOptions } from "../src/dataset-queries.ts";
import { createQueryClient } from "../src/query-client.ts";
import { SETTINGS, csvRecord, datasetRecord, pageRequest } from "./api-fixtures.mjs";

test("saved-report pages and counts use the same exact currency scope", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ method: init.method ?? "GET", params: new URL(url).searchParams });
    return new Response(
      init.method === "HEAD"
        ? null
        : csvRecord(datasetRecord("payouts", { currency: "JPY", source_amount: "123.4567" })),
      { headers: { "Content-Range": "0-0/1" } },
    );
  });
  const options = pageRequest("payouts", { currency: "JPY" });
  assert.equal((await client.fetchDatasetPage(options)).rows[0].source_amount, "123.4567");
  assert.equal(await client.fetchDatasetCount(options), 1);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "HEAD"],
  );
  for (const { params } of requests) assert.equal(params.get("currency"), "eq.JPY");
});

test("switching review currency cannot reuse another currency's pages or counts", () => {
  const identity = {
    session: { user: { id: "reviewer" }, access_token: "access" },
    account: { access_role: "administrator", company_id: null },
    skuOptions: [],
  };
  const client = createQueryClient();
  const options = pageRequest("payouts", { currency: "USD" });
  try {
    client.setQueryData(datasetQueryOptions(identity, options).queryKey, {
      rows: [{ currency: "USD" }],
      totalCount: 1,
    });
    client.setQueryData(datasetCountQueryOptions(identity, options).queryKey, 1);
    for (const currency of ["EUR", "JPY", undefined]) {
      const scope = { ...options, currency };
      assert.equal(client.getQueryData(datasetQueryOptions(identity, scope).queryKey), undefined);
      assert.equal(
        client.getQueryData(datasetCountQueryOptions(identity, scope).queryKey),
        undefined,
      );
    }
  } finally {
    client.clear();
  }
});

test("invalid currency scopes fail before a saved-report request", async () => {
  const client = createApiClient(SETTINGS, () => assert.fail("Invalid currency reached the API"));
  for (const currency of ["", "usd", "USD,EUR", "USD.or.currency.eq.EUR", null, ["USD"]]) {
    const options = pageRequest("payouts", { currency });
    await assert.rejects(client.fetchDatasetPage(options), /currency/);
    await assert.rejects(client.fetchDatasetCount(options), /currency/);
  }
});
