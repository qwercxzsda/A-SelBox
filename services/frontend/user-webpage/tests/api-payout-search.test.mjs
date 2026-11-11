import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, workspaceRevisionReply, pageRequest } from "./api-fixtures.mjs";

test("payout page and count resolve visible month labels to stored dates across all reference pages", async () => {
  const requests = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    if (workspaceRevisionReply(url)) return workspaceRevisionReply(url);
    const parsed = new URL(url);
    requests.push({ url: parsed, method: init.method });
    if (parsed.searchParams.get("select") === "id,start_date") {
      const offset = Number(parsed.searchParams.get("offset"));
      return new Response(
        offset === 0
          ? "id,start_date\nreport-one,2025-07-01"
          : offset === 1
            ? "id,start_date\nreport-two,2026-07-01"
            : "id,start_date",
      );
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
    await client.fetchDatasetPage(pageRequest("payouts", { search }));
    await client.fetchDatasetCount({ dataset: "payouts", accessToken: "test-access", search });
    const [page, count] = requests
      .filter(({ url }) => url.searchParams.get("select") !== "id,start_date")
      .slice(-2);
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

test("payout search rejects replacement during paging even when row count stays unchanged", async () => {
  for (const method of ["fetchDatasetPage", "fetchDatasetCount"]) {
    let rows = ["a,2026-01-01", "b,2026-07-01", "c,2026-08-01"];
    let revision = "before";
    let referenceReads = 0;
    const client = createApiClient(SETTINGS, async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/workspace_revisions")) {
        return Response.json({
          account: { user_id: "user-1", access_role: "member", company_id: "company-1" },
          revisions: { payouts: revision },
        });
      }
      assert.equal(
        parsed.searchParams.get("select"),
        "id,start_date",
        "No partial search may reach a page or count request",
      );
      const offset = Number(parsed.searchParams.get("offset"));
      const value = rows[offset];
      referenceReads += 1;
      // Latest January report moves past the cursor, leaving the total at three.
      // Offset one now skips July; the revision guard must reject the result.
      if (offset === 0) {
        rows = ["b,2026-07-01", "c,2026-08-01", "d,2026-01-01"];
        revision = "after";
      }
      return new Response(`id,start_date${value ? `\n${value}` : ""}`);
    });
    await assert.rejects(
      client[method](pageRequest("payouts", { search: "July" })),
      /changed while loading/,
    );
    assert.equal(referenceReads, 4);
  }
});

test("payout search rejects changed account scope and unassignment", async () => {
  for (const access_role of ["member", "unassigned"]) {
    let revisionReads = 0;
    const client = createApiClient(SETTINGS, async (url) => {
      if (new URL(url).pathname.endsWith("/workspace_revisions")) {
        revisionReads += 1;
        return Response.json({
          account:
            revisionReads === 1
              ? { user_id: "user-1", access_role: "member", company_id: "company-1" }
              : {
                  user_id: "user-1",
                  access_role,
                  company_id: access_role === "member" ? "company-2" : null,
                },
          revisions: { payouts: "one" },
        });
      }
      assert.equal(new URL(url).searchParams.get("select"), "id,start_date");
      return new Response("id,start_date");
    });
    await assert.rejects(
      client.fetchDatasetPage(pageRequest("payouts", { search: "July" })),
      (error) => error.status === 403,
    );
  }
});

test("aborted payout reference collection never sends a filtered page request", async () => {
  const controller = new AbortController();
  let referenceReads = 0;
  const client = createApiClient(SETTINGS, async (url) => {
    if (workspaceRevisionReply(url)) return workspaceRevisionReply(url);
    assert.equal(new URL(url).searchParams.get("select"), "id,start_date");
    referenceReads += 1;
    controller.abort();
    return new Response("id,start_date\na,2026-07-01");
  });
  await assert.rejects(
    client.fetchDatasetPage(pageRequest("payouts", { search: "July", signal: controller.signal })),
    { name: "AbortError" },
  );
  assert.equal(referenceReads, 1);
});
