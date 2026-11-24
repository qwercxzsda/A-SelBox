import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, pageRequest } from "./api-fixtures.mjs";

test("payout page and count resolve visible month labels to stored dates from one catalog request per search", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, method: init.method });
    if (parsed.pathname.endsWith("/payout_search_months")) {
      assert.equal(init.method, "POST");
      return Response.json(["2025-07-01", "2026-07-01"]);
    }
    return new Response(init.method === "HEAD" ? null : "id\n", {
      headers: { "Content-Range": "*/0" },
    });
  });
  for (const [search, dates] of [
    ["July", ['"2025-07-01"', '"2026-07-01"']],
    ["July 2026", ['"2026-07-01"']],
    ["2026-07", ['"2026-07-01"']],
    ["USD", []],
  ]) {
    requests.length = 0;
    await client.fetchDatasetPage(pageRequest("payouts", { search }));
    await client.fetchDatasetCount({ dataset: "payouts", accessToken: "test-access", search });
    assert.deepEqual(
      requests.map(({ method }) => method ?? "GET"),
      ["POST", "GET", "POST", "HEAD"],
    );
    const [, page, , count] = requests;
    assert.equal(page.url.searchParams.get("or"), count.url.searchParams.get("or"));
    const filter = page.url.searchParams.get("or");
    for (const date of dates) assert.ok(filter.includes(date));
    assert.equal(filter.includes("start_date.in"), dates.length > 0);
    assert.ok(filter.includes(`currency.imatch."${search}"`));
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

test("invalid or inaccessible month catalogs never produce partial payout searches", async () => {
  for (const method of ["fetchDatasetPage", "fetchDatasetCount"]) {
    for (const reply of [
      () => Response.json(["2026-02-30"]),
      () => Response.json({}),
      () => new Response(null, { status: 403 }),
    ]) {
      let calls = 0;
      const client = createApiClient(SETTINGS, async (url) => {
        calls++;
        assert.equal(new URL(url).pathname, "/rest/v1/rpc/payout_search_months");
        return reply();
      });
      await assert.rejects(
        client[method](pageRequest("payouts", { search: "July" })),
        (error) => error.status === 403 || /date|payout months/i.test(error.message),
      );
      assert.equal(calls, 1);
    }
  }
});

test("aborted payout month lookup never sends a filtered page request", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/payout_search_months");
    controller.abort();
    return Response.json(["2026-07-01"]);
  });
  await assert.rejects(
    client.fetchDatasetPage(pageRequest("payouts", { search: "July", signal: controller.signal })),
    { name: "AbortError" },
  );
});
