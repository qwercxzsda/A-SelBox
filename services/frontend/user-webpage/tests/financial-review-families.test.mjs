import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialReviewFamilies } from "../src/financial-review-families.ts";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";
const row = (source, component_type, amount) => ({ source, component_type, amount });

test("related fee types aggregate exactly with zero rows retained", () => {
  const result = buildFinancialReviewFamilies([
    row("FINANCES", "COUPON_FEES", "-6.530000009"),
    row("DATA_KIOSK", "COUPON_PARTICIPATION_FEE", "-5"),
    row("DATA_KIOSK", "COUPON_PERFORMANCE_FEE", "-1.530000001"),
    row("FINANCES", "DISPOSAL_FEES", "0"),
  ]);
  assert.equal(result.families[0].finances_amount, "-6.530000009");
  assert.equal(result.families[0].data_kiosk_amount, "-6.530000001");
  assert.equal(result.families[0].difference, "-0.000000008");
  assert.equal(result.families[1].difference, "0");
  assert.equal(result.families[1].coverage, "No Data Kiosk rows");
  assert.equal(result.unmatched.length, 0);
});

test("advertising, ambiguous labels and unknown types stay separate, with original amounts", () => {
  const rows = [
    row("FINANCES", "ADVERTISING", "-100"),
    row("DATA_KIOSK", "SPONSORED_PRODUCTS", "-90"),
    row("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE", "-10"),
    row("FINANCES", "FUTURE_FEE", "0"),
  ];
  const result = buildFinancialReviewFamilies(rows);
  assert.equal(result.families.length, 0);
  assert.deepEqual(result.unmatched, rows);
  assert.deepEqual(buildFinancialReviewFamilies([]), { families: [], unmatched: [] });
});

test("family totals fail closed on duplicate types or missing/invalid money", () => {
  for (const rows of [
    [row("FINANCES", "COUPON_FEES", null)],
    [row("FINANCES", "UNKNOWN", null)],
    [row("FINANCES", "UNKNOWN", "bad")],
    [row("FINANCES", "COUPON_FEES", "1"), row("FINANCES", "COUPON_FEES", "2")],
  ])
    assert.throws(() => buildFinancialReviewFamilies(rows));
});

test("family API requests the complete single-month/currency bounded type list without counts", async () => {
  const record = {
    ...row("FINANCES", "COUPON_FEES", "-6.53"),
    month: "2026-07-01",
    category: "DATA_KIOSK",
    currency: "USD",
    row_count: "2",
  };
  const client = createApiClient(SETTINGS, async (url, init) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("p_month_from"), "2026-07-01");
    assert.equal(params.get("p_month_to"), "2026-08-01");
    assert.equal(params.get("p_currency"), "USD");
    assert.equal(params.get("limit"), "1000");
    assert.equal(params.has("offset"), false);
    assert.equal(init.headers.Prefer, undefined);
    return new Response(csvRecord(record));
  });
  assert.equal(
    (await client.fetchFinancialReviewFamilyTypes("access", "DATA_KIOSK", "2026-07", "USD"))[0]
      .amount,
    "-6.53",
  );
});

test("family API rejects truncated or differently scoped responses", async () => {
  const record = {
    ...row("FINANCES", "COUPON_FEES", "-6.53"),
    month: "2026-07-01",
    category: "DATA_KIOSK",
    currency: "USD",
    row_count: "2",
  };
  for (const body of [
    csvRecord({ ...record, currency: "EUR" }),
    csvRecord(record).split("\n")[0] +
      "\n" +
      Array(1000).fill(csvRecord(record).split("\n")[1]).join("\n"),
  ]) {
    const client = createApiClient(SETTINGS, async () => new Response(body));
    await assert.rejects(
      client.fetchFinancialReviewFamilyTypes("access", "DATA_KIOSK", "2026-07", "USD"),
    );
  }
});
