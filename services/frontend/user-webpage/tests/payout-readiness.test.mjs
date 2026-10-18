import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, COMPANY_ID, OTHER_COMPANY_ID, csvRecord } from "./api-fixtures.mjs";

const row = {
  company_id: COMPANY_ID,
  company_name: "Company A",
  month: "2026-04-01",
  status: "BLOCKED",
  reason: "SETUP_REQUIRED",
  has_report: "false",
  last_success_at: null,
  next_attempt_at: "2026-10-18T18:00:00Z",
};

test("readiness loads only the requested month/company page without a count or source scan", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    assert.equal(parsed.pathname, "/rest/v1/rpc/payout_readiness");
    assert.equal(params.get("p_month"), "2026-04-01");
    assert.equal(params.get("p_company_ids"), `{${COMPANY_ID}}`);
    assert.equal(params.get("p_limit"), "26");
    assert.equal(params.get("p_offset"), "25");
    assert.equal(init.headers.Prefer, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    const selected = params.get("select").split(",");
    assert.deepEqual(selected, [...selected].sort());
    return new Response(csvRecord(row));
  });
  const result = await client.fetchPayoutReadiness(
    "access",
    "2026-04",
    [COMPANY_ID],
    1,
    controller.signal,
  );
  assert.deepEqual({ ...result.rows[0] }, row);
  assert.equal(result.hasNext, false);
});

test("blocker details retain exact SKU spelling and use a single company/month", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/rpc/payout_setup_blockers");
    assert.equal(parsed.searchParams.get("p_company_id"), COMPANY_ID);
    assert.equal(parsed.searchParams.get("p_month"), "2026-04-01");
    const columns = parsed.searchParams.get("select").split(",");
    assert.deepEqual(columns, [...columns].sort());
    return new Response(
      csvRecord({
        sku: "SKU.(exact)",
        reason: "MISSING_OWNERSHIP",
        component_count: "9007199254740993",
      }),
    );
  });
  const result = await client.fetchPayoutSetupBlockers("access", COMPANY_ID, "2026-04");
  assert.equal(result.rows[0].sku, "SKU.(exact)");
  assert.equal(result.rows[0].component_count, "9007199254740993");
});

test("readiness rejects invalid request scope and untrusted response scope", async () => {
  const noRequest = createApiClient(SETTINGS, () =>
    assert.fail("Invalid request reached transport"),
  );
  for (const month of ["2026-4", "2026-04-01", "0000-01", "2026-13"])
    await assert.rejects(noRequest.fetchPayoutReadiness("access", month));
  await assert.rejects(noRequest.fetchPayoutReadiness("access", "2026-04", ["other"]));
  await assert.rejects(noRequest.fetchPayoutReadiness("access", "2026-04", [], -1));
  await assert.rejects(noRequest.fetchPayoutSetupBlockers("access", "other", "2026-04"));
  for (const bad of [
    { ...row, month: "2026-05-01" },
    { ...row, status: "SECRET" },
    { ...row, company_id: "bad" },
  ]) {
    const client = createApiClient(SETTINGS, async () => new Response(csvRecord(bad)));
    await assert.rejects(client.fetchPayoutReadiness("access", "2026-04"));
  }
});

test("selected-company readiness cannot silently return another company's status", async () => {
  const client = createApiClient(
    SETTINGS,
    async () => new Response(csvRecord({ ...row, company_id: OTHER_COMPANY_ID })),
  );
  await assert.rejects(client.fetchPayoutReadiness("access", "2026-04", [COMPANY_ID]));
});
