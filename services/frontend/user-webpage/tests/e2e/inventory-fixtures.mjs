import { INVENTORY_COLUMNS } from "../../src/api/inventory.ts";
import { createReplies } from "./mocks/http.mjs";

export function inventoryRow(sku, overrides = {}) {
  return {
    ...Object.fromEntries(INVENTORY_COLUMNS.map((column) => [column, null])),
    capture_id: "inventory-capture-one",
    capture_date: "2026-09-28",
    marketplace_name: "Amazon.com",
    company_id: "company-a",
    sku,
    report_created_at: "2026-09-28T03:00:00Z",
    preprocessed_at: "2026-09-28T04:00:00Z",
    snapshot_date: "2026-09-27",
    ...overrides,
  };
}

export async function mockInventory(page, rows) {
  const state = { rows, requests: [], failed: false };
  await page.route("https://example.invalid/rest/v1/latest_inventory_items?**", async (route) => {
    const replies = createReplies(route);
    if (route.request().method() === "OPTIONS") return replies.reply({});
    const params = new URL(route.request().url()).searchParams;
    state.requests.push(params);
    if (state.failed) return replies.reply({ message: "private database details" }, 503);
    const exact = (column) => (params.has(column) ? params.get(column).slice(3) : null);
    const matching = state.rows.filter((row) =>
      ["sku", "marketplace_name"].every(
        (column) => exact(column) === null || row[column] === exact(column),
      ),
    );
    const offset = Number(params.get("offset"));
    return replies.csvReply(
      INVENTORY_COLUMNS,
      matching.slice(offset, offset + Number(params.get("limit"))),
      matching.length,
      offset,
    );
  });
  return state;
}
