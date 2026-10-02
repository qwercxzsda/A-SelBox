import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { INVENTORY_COLUMNS } from "../src/api/inventory.ts";
import {
  inventoryFilterOptions,
  recommendationLabel,
  recommendationTone,
  resolveInventorySearch,
} from "../src/inventory-options.ts";
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
  search: "",
  skus: [],
  healthStatuses: [],
  recommendations: [],
  sortColumn: "sku",
  sortDirection: "asc",
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
    skus: [row.sku],
    marketplace: "Amazon.com",
    pageIndex: 1,
    signal,
  });
  assert.equal(page.totalCount, 26);
  assert.equal(page.rows[0].sales_amount_90d, "9007199254740993.123456789");
  assert.equal(page.rows[0].available_quantity, "0");
  assert.equal(page.rows[0].reserved_quantity, null);
  assert.equal(captured.url.pathname, "/rest/v1/latest_inventory_items");
  assert.equal(captured.url.searchParams.get("and"), `(sku.in.(${JSON.stringify(row.sku)}))`);
  assert.equal(captured.url.searchParams.get("marketplace_name"), "eq.Amazon.com");
  assert.equal(captured.url.searchParams.get("offset"), "25");
  assert.equal(
    captured.url.searchParams.get("order"),
    "sku.asc.nullslast,marketplace_name.asc,capture_id.asc",
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

test("inventory preserves control whitespace inside literal SKU filters", async () => {
  let params;
  const client = createApiClient(SETTINGS, async (url) => {
    params = new URL(url).searchParams;
    return new Response(csvRecord(record()));
  });
  await client.fetchInventoryPage({ ...options, skus: ["SKU\n\tvalue"] });
  assert.equal(params.get("and"), '(sku.in.("SKU\n\tvalue"))');
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
    { skus: ["bad\0sku"] },
    { skus: [null] },
    { healthStatuses: [false] },
    { recommendations: [5] },
    { sortColumn: "currency" },
    { sortDirection: "sideways" },
    { search: "active search" },
    {
      search: "",
      searchValues: { skus: [], health_statuses: [], recommendations: [], marketplaces: [] },
    },
  ])
    await assert.rejects(client.fetchInventoryPage({ ...options, ...change }));
  assert.equal(reads, 0);
});

test("inventory status filters combine exact values and missing values with search, before numeric ordering", async () => {
  let params;
  const client = createApiClient(SETTINGS, async (url) => {
    params = new URL(url).searchParams;
    return new Response(csvRecord(record()));
  });
  await client.fetchInventoryPage({
    ...options,
    healthStatuses: ["Low stock", null],
    recommendations: ["SendToFBA"],
    sortColumn: "sales_amount_90d",
    sortDirection: "desc",
    search: "FBA",
    searchValues: {
      skus: [],
      health_statuses: [],
      recommendations: ["SendToFBA"],
      marketplaces: [],
    },
  });
  assert.equal(
    params.get("and"),
    '(or(health_status.in.("Low stock"),health_status.is.null),recommended_action.in.("SendToFBA"),or(recommended_action.in.("SendToFBA")))',
  );
  assert.equal(
    params.get("order"),
    "sales_amount_90d.desc.nullslast,sku.asc,marketplace_name.asc,capture_id.asc",
  );
  await client.fetchInventoryPage({
    ...options,
    search: "No results",
    searchValues: { skus: [], health_statuses: [], recommendations: [], marketplaces: [] },
  });
  assert.equal(params.get("and"), "(sku.is.null)");
  for (const column of ["health_status", "recommended_action"]) {
    for (const direction of ["asc", "desc"]) {
      await client.fetchInventoryPage({ ...options, sortColumn: column, sortDirection: direction });
      assert.equal(
        params.get("order"),
        `${column}_urgency.${direction}.nullslast,sku.asc,marketplace_name.asc,capture_id.asc`,
      );
    }
  }
});

test("inventory menus preserve unknown source labels, selected stale values, and exact nullable keys", () => {
  assert.equal(recommendationLabel("EditListing"), "Edit listing");
  assert.equal(recommendationTone("Edit listing"), "listing");
  assert.equal(recommendationLabel("GoToRestock"), "Restock");
  assert.equal(recommendationLabel("SendToFBA"), "Send to FBA");
  assert.equal(recommendationLabel("OtherSourceAction"), "OtherSourceAction");
  assert.equal(recommendationTone("OtherSourceAction"), "unknown");
  const options = inventoryFilterOptions([null, "Unavailable"], ["Old value"]);
  assert.equal(options.length, 3);
  assert.deepEqual(
    options.map(({ value }) => JSON.parse(value)).sort(),
    ["Old value", "Unavailable", null].sort(),
  );
  const catalog = {
    skus: [" SKU.*_%() ", "Another"],
    health_statuses: ["Low stock", null],
    recommendations: ["SendToFBA", "OtherSourceAction"],
  };
  assert.deepEqual(resolveInventorySearch(" send to fba ", catalog).recommendations, ["SendToFBA"]);
  assert.deepEqual(resolveInventorySearch("othErsource", catalog).recommendations, [
    "OtherSourceAction",
  ]);
  assert.deepEqual(resolveInventorySearch("Unavailable", catalog).health_statuses, [null]);
  assert.deepEqual(resolveInventorySearch(".*_%()", catalog).skus, [" SKU.*_%() "]);
  assert.equal(resolveInventorySearch("   ", catalog), null);
});

test("inventory filter catalogs use one authenticated complete RPC and reject malformed values", async () => {
  const values = {
    skus: ["A", "B"],
    health_statuses: ["Healthy", null],
    recommendations: ["SendToFBA", null],
  };
  let request;
  const client = createApiClient(SETTINGS, async (url, init) => {
    request = { url: new URL(url), init };
    return Response.json(values);
  });
  assert.deepEqual(await client.fetchInventoryFilterOptions("access"), values);
  assert.equal(request.url.pathname, "/rest/v1/rpc/inventory_filter_options");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer access");
  assert.deepEqual(JSON.parse(request.init.body), {});
  const broken = createApiClient(SETTINGS, async () => Response.json({ ...values, skus: [null] }));
  await assert.rejects(broken.fetchInventoryFilterOptions("access"), /invalid/);
});

test("health filter choices prioritize urgent known statuses over alphabetical unknowns", () => {
  const values = [
    null,
    "Healthy",
    "Unexpected health",
    "Low stock",
    "Excess",
    "Out of stock",
    "OUT_OF_STOCK",
    "high_stock",
    "overstock",
    "Excess inventory",
  ];
  const choices = inventoryFilterOptions(values, ["Stale status"], "health_status");
  const labels = choices.map(({ label }) => label);
  assert.deepEqual(new Set(labels.slice(0, 2)), new Set(["Out of stock", "OUT_OF_STOCK"]));
  assert.equal(labels[2], "Low stock");
  assert.deepEqual(
    new Set(labels.slice(3, 7)),
    new Set(["Excess", "Excess inventory", "high_stock", "overstock"]),
  );
  assert.equal(labels[7], "Healthy");
  assert.deepEqual(
    new Set(labels.slice(8)),
    new Set(["Unexpected health", "Unavailable", "Stale status"]),
  );
  assert.deepEqual(
    new Set(choices.map(({ value }) => JSON.parse(value))),
    new Set([...values, "Stale status"]),
  );
});

test("recommendation menus use action priorities and normalize known aliases without changing filter values", () => {
  const values = [
    "NoExcessInventory",
    "Advertise listing",
    "SEND_TO_FBA",
    "GoToRestock",
    "restock inventory",
    "EDIT_LISTING",
    "Edit listing",
    "No action required",
    "A custom recommendation",
    null,
  ];
  const choices = inventoryFilterOptions(values, [], "recommended_action");
  assert.deepEqual(
    choices.map(({ label }) => label),
    [
      "Edit listing",
      "Edit listing",
      "Restock",
      "Restock",
      "Send to FBA",
      "Advertise listing",
      "No action required",
      "No excess inventory",
      "A custom recommendation",
      "Unavailable",
    ],
  );
  assert.deepEqual(new Set(choices.map(({ value }) => JSON.parse(value))), new Set(values));
  assert.equal(recommendationTone("EDIT_LISTING"), "listing");
  assert.equal(recommendationTone("restock inventory"), "restock");
  assert.equal(recommendationTone("SEND_TO_FBA"), "shipment");
  assert.equal(recommendationLabel("A custom recommendation"), "A custom recommendation");
  assert.deepEqual(
    resolveInventorySearch("no excess inventory", {
      skus: [],
      health_statuses: [],
      recommendations: values,
    }).recommendations,
    ["NoExcessInventory"],
  );
});
