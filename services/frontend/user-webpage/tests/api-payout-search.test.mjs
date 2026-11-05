import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, pageRequest } from "./api-fixtures.mjs";

test("payout page and count search the visible month label with the same literal filter", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push({ url: new URL(url), method: init.method });
    return new Response(init.method === "HEAD" ? null : "id\n", {
      headers: { "Content-Type": "text/csv", "Content-Range": "*/0" },
    });
  });
  for (const search of ["July", "July 2026", "2026-07", "USD"]) {
    await client.fetchDatasetPage(pageRequest("payouts", { search }));
    await client.fetchDatasetCount({ dataset: "payouts", accessToken: "test-access", search });
    const [page, count] = requests.slice(-2);
    assert.equal(page.url.pathname, "/rest/v1/latest_company_payout_reports");
    assert.equal(page.url.searchParams.get("or"), count.url.searchParams.get("or"));
    assert.ok(page.url.searchParams.get("or").includes(`month_label.imatch."${search}"`));
    assert.ok(page.url.searchParams.get("or").includes(`report_name.imatch."${search}"`));
  }
});

test("payout pages and counts keep marketplace and amount-unit scope identical", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    requests.push(new URL(url));
    return new Response(init.method === "HEAD" ? null : "id\n", {
      headers: { "Content-Range": "*/0" },
    });
  });
  const options = pageRequest("payouts", {
    currency: "EUR",
    filters: { marketplaces: ["Amazon.de", "Amazon.fr"] },
  });
  await client.fetchDatasetPage(options);
  await client.fetchDatasetCount(options);
  for (const request of requests) {
    assert.equal(request.searchParams.get("marketplace_name"), 'in.("Amazon.de","Amazon.fr")');
    assert.equal(request.searchParams.get("currency"), "eq.EUR");
  }
  assert.equal(
    requests[0].searchParams.get("order"),
    "start_date.desc.nullslast,company_id.asc,marketplace_name.asc.nullslast,currency.asc,id.asc",
  );
});
