import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

test("financial review rows and month totals match their RPC CSV column names", async () => {
  const expected = {
    amazon_scope: "NA",
    currency: "USD",
    marketplace_name: "Amazon.com",
    seller_namespace: "test-seller",
  };
  const amount = {
    ...expected,
    base_amount: "-0.0015",
    outcome: "DIFFERENCE",
    posted_date: "2026-04-09",
    reason: "ROUNDING",
    skus: '["SKU-A","SKU-B"]',
    source_row_id: "0198b50b-701a-7000-8000-000000000042",
  };
  const month = {
    ...expected,
    month: "2026-04-01",
    company_base: "14.95",
    finances_base: "14.9485",
    difference_base: "-0.0015",
  };
  const client = createApiClient(SETTINGS, async (url) => {
    const parsed = new URL(url);
    const row = parsed.pathname.endsWith("/financial_outcome_page") ? amount : month;
    const columns = parsed.searchParams.get("select").split(",");
    const [, values] = csvRecord(
      Object.fromEntries(columns.map((field) => [field, row[field] ?? null])),
    ).split("\n");
    return new Response([...columns].sort().join(",") + "\n" + values);
  });
  const result = await client.fetchFinancialOutcomes(
    "access",
    { outcome: "DIFFERENCE", month: "2026-04", marketplace: "Amazon.com" },
    0,
  );
  for (const [field, value] of Object.entries(amount)) assert.equal(result.rows[0][field], value);
  assert.equal(result.rows[0].sku, "SKU-A, SKU-B");
  const totals = await client.fetchOutcomeMonths("access", "2026-04", "Amazon.com", 0);
  for (const [field, value] of Object.entries(month)) assert.equal(totals.rows[0][field], value);
});
