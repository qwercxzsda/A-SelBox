import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, responseJson, pageRequest, datasetFilters } from "./api-fixtures.mjs";
import { searchValues } from "./search-fixtures.mjs";

test("resolved search preserves OR sets separately from column filters and distinguishes no matches", async () => {
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    const requests = [];
    const client = createApiClient(SETTINGS, async (url, init) => {
      requests.push(JSON.parse(init.body));
      return responseJson(
        new URL(url).pathname.endsWith("_count") ? "0" : { rows: [], total_count: "0" },
      );
    });
    const selected = datasetFilters({ skus: ["COLUMN-SKU"], types: ["COLUMN-TYPE"] });
    const matches = searchValues({
      skus: [" exact SKU ", "SKU_100%", "SKU_100%"],
      types: ["PRODUCT_REFUNDS"],
      marketplaces: ["Amazon.com"],
      sources: dataset === "live" ? ["DATA_KIOSK"] : [],
    });
    await client.fetchDatasetPage(
      pageRequest(dataset, { search: "refund", searchValues: matches, filters: selected }),
    );
    assert.deepEqual(requests[0].p_skus, ["COLUMN-SKU"]);
    assert.deepEqual(requests[0].p_types, ["COLUMN-TYPE"]);
    assert.deepEqual(requests[0].p_search_skus, [" exact SKU ", "SKU_100%"]);
    assert.deepEqual(requests[0].p_search_types, ["PRODUCT_REFUNDS"]);
    assert.deepEqual(requests[0].p_search_marketplaces, ["Amazon.com"]);
    assert.equal("p_search" in requests[0], false);
    assert.equal("p_search_currency" in requests[0], false);
    assert.equal("p_search_sources" in requests[0], dataset === "live");

    await client.fetchDatasetPage(
      pageRequest(dataset, { search: "no catalog match", searchValues: searchValues() }),
    );
    for (const field of ["skus", "types", "marketplaces"])
      assert.deepEqual(requests[1][`p_search_${field}`], []);
    await client.fetchDatasetCount({ dataset, accessToken: "test-access", search: "" });
    for (const field of ["skus", "types", "marketplaces"])
      assert.equal(requests[2][`p_search_${field}`], null);
  }
});

test("unresolved or malformed transaction search fails before any HTTP request", async () => {
  const client = createApiClient(SETTINGS, () => assert.fail("Invalid search must not reach HTTP"));
  const invalidValues = [undefined, null, {}, [], searchValues({ skus: Array(1) })];
  for (const field of ["skus", "types", "marketplaces", "sources"]) {
    for (const invalid of [null, "A", [null], [""], ["bad\0value"], [123]]) {
      invalidValues.push(searchValues({ [field]: invalid }));
    }
  }
  for (const values of invalidValues) {
    for (const dataset of ["live", "settlement", "data_kiosk"]) {
      await assert.rejects(
        client.fetchDatasetPage(pageRequest(dataset, { search: "active", searchValues: values })),
      );
      await assert.rejects(
        client.fetchDatasetCount({
          accessToken: "test-access",
          dataset,
          search: "active",
          searchValues: values,
        }),
      );
    }
  }
  await assert.rejects(
    client.fetchDatasetPage(pageRequest("live", { search: " ", searchValues: searchValues() })),
  );
});
