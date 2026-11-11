import { INVENTORY_CAPTURE_COLUMNS, INVENTORY_COLUMNS } from "../../src/api/inventory.ts";
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

function compareRows(left, right, order) {
  for (const clause of order.split(",")) {
    const [column] = clause.split(".");
    if (left[column] !== right[column]) return left[column] < right[column] ? -1 : 1;
  }
  return 0;
}

export async function mockInventory(page, rows) {
  const state = {
    rows,
    requests: [],
    captureRequests: [],
    captures: null,
    failed: false,
    coverageFailed: false,
  };
  await page.route(
    "https://example.invalid/rest/v1/latest_inventory_captures?**",
    async (route) => {
      const replies = createReplies(route);
      if (route.request().method() === "OPTIONS") return replies.reply({});
      const params = new URL(route.request().url()).searchParams;
      state.captureRequests.push(params);
      if (state.coverageFailed) return replies.reply({}, 503);
      const captures = state.captures ?? [
        ...new Map(
          state.rows.map((row) => [
            `${row.capture_id}:${row.marketplace_name}`,
            { ...row, capture_id: `${row.capture_id}:${row.marketplace_name}` },
          ]),
        ).values(),
      ];
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      return replies.csvReply(
        INVENTORY_CAPTURE_COLUMNS,
        captures.slice(offset, offset + limit),
        captures.length,
        offset,
      );
    },
  );
  await page.route("https://example.invalid/rest/v1/latest_inventory_items?**", async (route) => {
    const replies = createReplies(route);
    if (route.request().method() === "OPTIONS") return replies.reply({});
    const params = new URL(route.request().url()).searchParams;
    state.requests.push(params);
    if (state.failed) return replies.reply({ message: "private database details" }, 503);
    const matching = [...state.rows].sort((left, right) =>
      compareRows(left, right, params.get("order")),
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
