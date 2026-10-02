import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { DETAIL_PAGE_SIZE } from "../src/api/pagination.ts";
import { SETTINGS, COMPANY_ID, OTHER_COMPANY_ID, csvRecord } from "./api-fixtures.mjs";

const OPTIONS = {
  accessToken: "test-access",
  companyId: COMPANY_ID,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  currency: "USD",
  pageIndex: 0,
};

test("payout history uses one exact company, period and currency scope with stable paging", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/company_payout_reports");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      select: DATASET_CONFIG.payouts.selectColumns.join(","),
      company_id: `eq.${COMPANY_ID}`,
      start_date: "eq.2026-07-01",
      end_date: "eq.2026-07-31",
      currency: "eq.USD",
      order: "created_at.desc,id.desc",
      limit: String(DETAIL_PAGE_SIZE),
      offset: String(DETAIL_PAGE_SIZE),
    });
    assert.equal(init.headers.Prefer, "count=exact");
    assert.equal(init.headers.Accept, "text/csv");
    assert.equal(init.headers.Authorization, "Bearer test-access");
    assert.equal(init.signal, controller.signal);
    return new Response(
      csvRecord({ id: OTHER_COMPANY_ID, company_amount: "9007199254740993.123456789" }),
      { headers: { "Content-Range": "50-50/51" } },
    );
  });
  const result = await client.fetchPayoutHistory({
    ...OPTIONS,
    pageIndex: 1,
    signal: controller.signal,
  });
  assert.equal(result.totalCount, 51);
  assert.equal(result.rows[0].company_amount, "9007199254740993.123456789");
});

test("payout history rejects incomplete or malformed scopes before requesting data", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return new Response("id\n");
  });
  for (const [override, error] of [
    [{ companyId: "all" }, /company ID/],
    [{ companyId: `${COMPANY_ID},${OTHER_COMPANY_ID}` }, /company ID/],
    [{ startDate: "" }, /valid date/],
    [{ startDate: "2026-02-30" }, /valid calendar date/],
    [{ endDate: "" }, /valid date/],
    [{ endDate: "2026-06-30" }, /on or before/],
    [{ currency: "" }, /currency code/],
    [{ currency: "usd" }, /currency code/],
    [{ currency: 'USD",EUR' }, /currency code/],
    [{ pageIndex: -1 }, /Page index/],
    [{ pageIndex: 0.5 }, /Page index/],
    [{ pageIndex: Number.MAX_SAFE_INTEGER }, /Page offset/],
  ]) {
    await assert.rejects(client.fetchPayoutHistory({ ...OPTIONS, ...override }), error);
  }
  assert.equal(requests, 0);
});

test("payout history preserves an empty out-of-range page and its current count", async () => {
  const client = createApiClient(
    SETTINGS,
    async () => new Response("", { status: 416, headers: { "Content-Range": "*/2" } }),
  );
  assert.deepEqual(await client.fetchPayoutHistory({ ...OPTIONS, pageIndex: 1 }), {
    rows: [],
    totalCount: 2,
  });
});

test("empty payout history uses an explicit null currency without widening its scope", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("company_id"), `eq.${COMPANY_ID}`);
    assert.equal(params.get("start_date"), "eq.2026-07-01");
    assert.equal(params.get("end_date"), "eq.2026-07-31");
    assert.equal(params.get("currency"), "is.null");
    return new Response(csvRecord({ id: COMPANY_ID, currency: null, company_amount: "0" }), {
      headers: { "Content-Range": "0-0/1" },
    });
  });
  const result = await client.fetchPayoutHistory({ ...OPTIONS, currency: null });
  assert.equal(result.totalCount, 1);
  assert.equal(result.rows[0].currency, null);
});

test("selected payout versions load directly by ID within their original scope without counting history", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/company_payout_reports");
    const params = new URL(url).searchParams;
    assert.deepEqual(Object.fromEntries(params), {
      select: DATASET_CONFIG.payouts.selectColumns.join(","),
      company_id: `eq.${COMPANY_ID}`,
      start_date: "eq.2026-07-01",
      end_date: "eq.2026-07-31",
      currency: "is.null",
      id: `eq.${OTHER_COMPANY_ID}`,
      limit: "1",
    });
    assert.equal(init.headers.Prefer, undefined);
    assert.equal(init.headers.Authorization, "Bearer test-access");
    assert.equal(init.signal, controller.signal);
    return new Response(csvRecord({ id: OTHER_COMPANY_ID, currency: null, company_amount: "0" }));
  });
  const row = await client.fetchPayoutVersion({
    ...OPTIONS,
    currency: null,
    reportId: OTHER_COMPANY_ID,
    signal: controller.signal,
  });
  assert.equal(row.id, OTHER_COMPANY_ID);
  assert.equal(row.currency, null);
});

test("selected payout versions return null when the scoped ID is unavailable and reject invalid IDs", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return new Response("id\n");
  });
  assert.equal(await client.fetchPayoutVersion({ ...OPTIONS, reportId: OTHER_COMPANY_ID }), null);
  await assert.rejects(client.fetchPayoutVersion({ ...OPTIONS, reportId: "invalid" }), /report ID/);
  await assert.rejects(
    client.fetchPayoutVersion({ ...OPTIONS, companyId: "invalid", reportId: OTHER_COMPANY_ID }),
    /company ID/,
  );
  assert.equal(requests, 1);
});
