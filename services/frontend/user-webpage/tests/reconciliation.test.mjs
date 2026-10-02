import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, COMPANY_ID, csvRecord } from "./api-fixtures.mjs";

test("saved review totals are report scoped and keep currencies separate", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/payout_reconciliation_totals");
    assert.equal(parsed.searchParams.get("report_id"), `eq.${COMPANY_ID}`);
    assert.equal(parsed.searchParams.has("currency"), false);
    assert.equal(parsed.searchParams.get("order"), "currency.asc");
    assert.equal(init.headers.Accept, "text/csv");
    assert.equal(init.headers.Prefer, undefined);
    assert.equal(init.signal, controller.signal);
    return new Response(
      csvRecord({ currency: "JPY", difference: "333076.9326", source_group_count: "123456" }),
    );
  });
  assert.equal(
    (await client.fetchPayoutReconciliationTotals("access", COMPANY_ID, controller.signal))[0]
      .difference,
    "333076.9326",
  );
});

test("saved review rejects malformed report IDs before querying and refuses truncated currency totals", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests++;
    return new Response(
      `currency,difference\n${Array.from({ length: 1000 }, () => "JPY,0").join("\n")}`,
    );
  });
  for (const id of ["", "not-a-report", `${COMPANY_ID},report_id.not.is.null`])
    await assert.rejects(client.fetchPayoutReconciliationTotals("access", id), /valid report ID/);
  assert.equal(requests, 0);
  await assert.rejects(
    client.fetchPayoutReconciliationTotals("access", COMPANY_ID),
    /too many currencies/,
  );
});
