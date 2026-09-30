import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { INVENTORY_COLUMNS } from "../src/api/inventory.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

function record(overrides = {}) {
  return {
    ...Object.fromEntries(INVENTORY_COLUMNS.map((column) => [column, null])),
    capture_id: "capture-one",
    capture_date: "2026-09-28",
    marketplace_name: "Amazon.com",
    sku: ' SKU.*_%(),"\\ ',
    report_created_at: "2026-09-28T03:00:00Z",
    preprocessed_at: "2026-09-28T04:00:00Z",
    ...overrides,
  };
}

const options = {
  sku: "",
  marketplace: "",
  pageIndex: 0,
  pageSize: 25,
  accessToken: "test-access",
};

test("inventory filters exact SKU text before stable pagination and keeps decimal precision and unknowns", async () => {
  let captured;
  const row = record({ sales_amount_90d: "9007199254740993.123456789", available_quantity: "0" });
  const client = createApiClient(SETTINGS, async (url, init) => {
    captured = { url: new URL(url), init };
    return new Response(csvRecord(row), { headers: { "Content-Range": "25-25/26" } });
  });
  const signal = new AbortController().signal;
  const page = await client.fetchInventoryPage({
    ...options,
    sku: row.sku,
    marketplace: "Amazon.com",
    pageIndex: 1,
    signal,
  });
  assert.equal(page.totalCount, 26);
  assert.equal(page.rows[0].sales_amount_90d, "9007199254740993.123456789");
  assert.equal(page.rows[0].available_quantity, "0");
  assert.equal(page.rows[0].reserved_quantity, null);
  assert.equal(captured.url.pathname, "/rest/v1/latest_inventory_items");
  assert.equal(captured.url.searchParams.get("sku"), "eq." + row.sku);
  assert.equal(captured.url.searchParams.get("marketplace_name"), "eq.Amazon.com");
  assert.equal(captured.url.searchParams.get("offset"), "25");
  assert.equal(
    captured.url.searchParams.get("order"),
    "sku.asc,marketplace_name.asc,capture_id.asc",
  );
  assert.equal(captured.url.searchParams.has("or"), false);
  assert.equal(captured.url.searchParams.get("select").includes("seller_namespace"), false);
  assert.equal(captured.init.headers.Accept, "text/csv");
  assert.equal(captured.init.headers.Prefer, "count=exact");
  assert.equal(captured.init.headers.Authorization, "Bearer test-access");
  assert.equal(captured.init.signal, signal);
});

test("inventory handles shrinking pages, rejects incomplete projections and hides server errors", async () => {
  const empty = createApiClient(
    SETTINGS,
    async () => new Response(null, { status: 416, headers: { "Content-Range": "*/0" } }),
  );
  assert.deepEqual(await empty.fetchInventoryPage({ ...options, pageIndex: 1 }), {
    rows: [],
    totalCount: 0,
  });
  const partial = createApiClient(SETTINGS, async () => new Response(csvRecord({ sku: "A" })));
  await assert.rejects(partial.fetchInventoryPage(options), /incomplete row/);
  const failed = createApiClient(
    SETTINGS,
    async () => new Response("private server detail", { status: 403 }),
  );
  await assert.rejects(
    failed.fetchInventoryPage(options),
    (error) => error.status === 403 && !error.message.includes("private server"),
  );
});

test("invalid inventory scope or offsets fail before any request", async () => {
  let reads = 0;
  const client = createApiClient(SETTINGS, async () => {
    reads += 1;
    return new Response("");
  });
  for (const change of [
    { pageIndex: -1 },
    { pageSize: 0 },
    { pageSize: 1001 },
    { pageIndex: Number.MAX_SAFE_INTEGER },
    { marketplace: "not-a-marketplace" },
    { sku: "bad\0sku" },
  ])
    await assert.rejects(client.fetchInventoryPage({ ...options, ...change }));
  assert.equal(reads, 0);
});
