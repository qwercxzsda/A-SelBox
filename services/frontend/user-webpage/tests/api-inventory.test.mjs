import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { INVENTORY_CAPTURE_COLUMNS, INVENTORY_COLUMNS } from "../src/api/inventory.ts";
import { inventoryPage } from "../src/inventory-view.ts";
import {
  inventoryFilterOptions,
  INVENTORY_HEALTH_VALUES,
  INVENTORY_RECOMMENDATION_VALUES,
  recommendationLabel,
  recommendationTone,
} from "../src/inventory-options.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";
const revisions = {
  account: { user_id: "member", access_role: "member", company_id: "a" },
  revisions: { inventory: "one", fees: "one" },
};
const revisionReply = (url) =>
  new URL(url).pathname.endsWith("/workspace_revisions") ? Response.json(revisions) : null;
function record(overrides = {}) {
  return {
    ...Object.fromEntries(INVENTORY_COLUMNS.map((column) => [column, null])),
    capture_id: "capture-one",
    capture_date: "2026-09-28",
    marketplace_name: "Amazon.com",
    sku: ' SKU.*_%()," ',
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
};
test("inventory capture discovery retains empty capture references and handles smaller server pages without counts", async () => {
  const captures = [
    {
      capture_id: "empty-us",
      marketplace_name: "Amazon.com",
      capture_date: "2026-10-18",
      report_created_at: "2026-10-18T01:00:00Z",
      preprocessed_at: "2026-10-18T02:00:00Z",
    },
    {
      capture_id: "jp",
      marketplace_name: "Amazon.co.jp",
      capture_date: "2026-10-17",
      report_created_at: "2026-10-17T01:00:00Z",
      preprocessed_at: "2026-10-18T02:00:00Z",
    },
  ];
  const offsets = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    if (revisionReply(url)) return revisionReply(url);
    const params = new URL(url).searchParams;
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    assert.equal(new URL(url).pathname, "/rest/v1/latest_inventory_captures");
    assert.equal(params.get("order"), "marketplace_name.asc,capture_id.asc");
    assert.equal(params.get("select"), INVENTORY_CAPTURE_COLUMNS.join(","));
    assert.equal(init.headers.Prefer, undefined);
    return new Response(
      offset < captures.length ? csvRecord(captures[offset]) : INVENTORY_CAPTURE_COLUMNS.join(","),
    );
  });
  assert.deepEqual(
    (await client.fetchInventoryCaptures("access")).map((row) => ({ ...row })),
    captures,
  );
  assert.deepEqual(offsets, [0, 1, 2]);
  const repeated = createApiClient(SETTINGS, async () => new Response(csvRecord(captures[0])));
  await assert.rejects(repeated.fetchInventoryCaptures("access"), /did not advance/);
  const incomplete = createApiClient(
    SETTINGS,
    async () => new Response(csvRecord({ capture_id: "missing-dates" })),
  );
  await assert.rejects(incomplete.fetchInventoryCaptures("access"), /incomplete capture/);
});

test("inventory loads every authorized row before display, preserving exact values and smaller server pages", async () => {
  const records = [
    record({ sku: "A", sales_amount_90d: "9007199254740993.123456789", available_quantity: "0" }),
    record({ sku: "B" }),
  ];
  const offsets = [];
  const client = createApiClient(SETTINGS, async (url, init) => {
    if (revisionReply(url)) return revisionReply(url);
    const params = new URL(url).searchParams;
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    assert.equal(new URL(url).pathname, "/rest/v1/latest_inventory_items");
    assert.equal(params.get("order"), "capture_id.asc,sku.asc");
    assert.equal(params.get("select"), INVENTORY_COLUMNS.join(","));
    assert.equal(params.has("and"), false);
    assert.equal(init.headers.Prefer, undefined);
    assert.equal(init.headers.Authorization, "Bearer access");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(
      offset < records.length ? csvRecord(records[offset]) : INVENTORY_COLUMNS.join(","),
    );
  });
  assert.deepEqual(
    (await client.fetchInventoryRows("access", revisions.account)).map((row) => ({ ...row })),
    records,
  );
  assert.deepEqual(offsets, [0, 1, 2]);
});

test("incomplete, repeated, failed and aborted inventory reads never become partial success", async () => {
  const repeated = createApiClient(
    SETTINGS,
    async (url) => revisionReply(url) ?? new Response(csvRecord(record())),
  );
  await assert.rejects(repeated.fetchInventoryRows("access", revisions.account), /did not advance/);
  const partial = createApiClient(
    SETTINGS,
    async (url) => revisionReply(url) ?? new Response(csvRecord({ sku: "A" })),
  );
  await assert.rejects(partial.fetchInventoryRows("access", revisions.account), /incomplete row/);
  const [header, row] = csvRecord(record()).split("\n");
  const oversized = createApiClient(
    SETTINGS,
    async (url) =>
      revisionReply(url) ??
      new Response([header, ...Array.from({ length: 1001 }, () => row)].join("\n")),
  );
  await assert.rejects(oversized.fetchInventoryRows("access", revisions.account), /too many rows/);
  const failed = createApiClient(
    SETTINGS,
    async () => new Response("private database detail", { status: 403 }),
  );
  await assert.rejects(
    failed.fetchInventoryRows("access", revisions.account),
    (error) => error.status === 403 && !error.message.includes("private"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(repeated.fetchInventoryRows("access", revisions.account, controller.signal));
});

test("browser searches literal source values and display labels and combines filters before pagination", () => {
  const rows = [
    record({ sku: "A", health_status: "Low stock", recommended_action: "SendToFBA" }),
    record({ sku: "B", health_status: "Low stock", recommended_action: "GoToRestock" }),
    record(),
  ];
  const skus = (patch) => inventoryPage(rows, { ...options, ...patch }).rows.map((row) => row.sku);
  assert.deepEqual(skus({ search: "send to fba" }), ["A"]);
  assert.deepEqual(skus({ search: "sendtofba" }), ["A"]);
  assert.deepEqual(skus({ search: ".*_%()" }), [rows[2].sku]);
  assert.deepEqual(skus({ search: "unavailable" }), [rows[2].sku]);
  assert.deepEqual(skus({ healthStatuses: ["Low stock"], recommendations: ["SendToFBA"] }), ["A"]);
  assert.deepEqual(skus({ skus: [rows[2].sku], marketplace: "Amazon.ca" }), []);
  assert.deepEqual(
    inventoryPage(rows, { ...options, healthStatuses: ["Low stock"], pageSize: 1, pageIndex: 1 }),
    { rows: [rows[1]], totalCount: 2 },
  );
});

test("complete-set sorting preserves exact signed amounts, urgency ties, and nulls last in either direction", () => {
  const rows = [
    record({
      sku: "B",
      sales_amount_90d: "9007199254740993.000000002",
      health_status: "Low stock",
    }),
    record({
      sku: "A",
      sales_amount_90d: "9007199254740993.000000001",
      health_status: "Out of stock",
    }),
    record({ sku: "D", sales_amount_90d: "-9007199254740993.000000001", health_status: "Healthy" }),
    record({ sku: "C", sales_amount_90d: "-9007199254740993.000000002", health_status: "Healthy" }),
    record({ sku: "E" }),
  ];
  const order = (column, direction) =>
    inventoryPage(rows, { ...options, sortColumn: column, sortDirection: direction }).rows.map(
      (row) => row.sku,
    );
  assert.deepEqual(order("sales_amount_90d", "asc"), ["C", "D", "A", "B", "E"]);
  assert.deepEqual(order("sales_amount_90d", "desc"), ["B", "A", "D", "C", "E"]);
  assert.deepEqual(order("health_status", "desc"), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(order("health_status", "asc"), ["C", "D", "B", "A", "E"]);
  assert.deepEqual(
    inventoryPage(rows, {
      ...options,
      sortColumn: "sales_amount_90d",
      sortDirection: "desc",
      pageIndex: 1,
      pageSize: 2,
    }).rows.map((row) => row.sku),
    ["D", "C"],
  );
});

test("fixed catalogs include the agreed vocabulary even when no source row currently uses it", () => {
  assert.deepEqual(
    inventoryFilterOptions(INVENTORY_HEALTH_VALUES, [], "health_status").map(({ label }) => label),
    ["Out of stock", "Low stock", "Excess", "Healthy", "Unavailable"],
  );
  assert.deepEqual(
    inventoryFilterOptions(INVENTORY_RECOMMENDATION_VALUES, [], "recommended_action").map(
      ({ label }) => label,
    ),
    [
      "Create shipping plan",
      "Restock",
      "Send to FBA",
      "Resolve stranded inventory",
      "Edit listing",
      "Lower price",
      "Advertise listing",
      "No excess inventory",
      "No restock or excess action required",
      "Unavailable",
    ],
  );
  assert.equal(recommendationLabel("GoToStranded"), "Resolve stranded inventory");
  assert.equal(recommendationTone("Edit listing"), "listing");
  assert.equal(recommendationLabel(null), "Unavailable");
});

test("inventory rejects a mixed snapshot when rows disappear between pages", async () => {
  let revisionReads = 0;
  const client = createApiClient(SETTINGS, async (url) => {
    const params = new URL(url).searchParams;
    if (new URL(url).pathname.endsWith("/workspace_revisions")) {
      revisionReads += 1;
      return Response.json({
        ...revisions,
        revisions: { ...revisions.revisions, inventory: String(revisionReads) },
      });
    }
    return new Response(
      params.get("offset") === "0" ? csvRecord(record()) : INVENTORY_COLUMNS.join(","),
    );
  });
  await assert.rejects(
    client.fetchInventoryRows("access", revisions.account),
    /changed while loading/,
  );
});

test("inventory access changes during a complete read clear the old account scope", async () => {
  for (const account of [
    { ...revisions.account, company_id: "another-company" },
    { ...revisions.account, access_role: "administrator", company_id: null },
    { ...revisions.account, access_role: "unassigned", company_id: null },
  ]) {
    let revisionReads = 0;
    const client = createApiClient(SETTINGS, async (url) => {
      if (new URL(url).pathname.endsWith("/workspace_revisions")) {
        revisionReads += 1;
        return Response.json({
          ...revisions,
          account: revisionReads === 1 ? revisions.account : account,
        });
      }
      return new Response(
        new URL(url).searchParams.get("offset") === "0"
          ? csvRecord(record())
          : INVENTORY_COLUMNS.join(","),
      );
    });
    await assert.rejects(
      client.fetchInventoryRows("access", revisions.account),
      (error) => error.status === 403,
    );
  }
});

test("unassigned accounts fail before an inventory data request", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    assert.ok(new URL(url).pathname.endsWith("/workspace_revisions"));
    return Response.json({
      ...revisions,
      account: { ...revisions.account, access_role: "unassigned", company_id: null },
    });
  });
  await assert.rejects(
    client.fetchInventoryRows("access", revisions.account),
    (error) => error.status === 403,
  );
});

test("inventory rejects an account change before reading into the cached scope", async () => {
  const client = createApiClient(SETTINGS, async (url) => {
    assert.ok(new URL(url).pathname.endsWith("/workspace_revisions"));
    return Response.json({
      ...revisions,
      account: { ...revisions.account, company_id: "new-company" },
    });
  });
  await assert.rejects(
    client.fetchInventoryRows("access", revisions.account),
    (error) => error.status === 403,
  );
});
