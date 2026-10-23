import { INVENTORY_CAPTURE_COLUMNS, INVENTORY_COLUMNS } from "../../src/api/inventory.ts";
import { createReplies } from "./mocks/http.mjs";
import { compareAmounts } from "./record-fixtures.mjs";

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
    health_status_urgency: null,
    recommended_action_urgency: null,
    ...overrides,
  };
}

function splitExpressions(text) {
  const result = [];
  let depth = 0,
    quoted = false,
    escaped = false,
    start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      result.push(text.slice(start, index));
      start = index + 1;
    }
  }
  result.push(text.slice(start));
  return result;
}

function matches(row, expression) {
  if (expression.startsWith("or("))
    return splitExpressions(expression.slice(3, -1)).some((part) => matches(row, part));
  if (expression.startsWith("and("))
    return splitExpressions(expression.slice(4, -1)).every((part) => matches(row, part));
  const nullable = /^(\w+)\.is\.null$/.exec(expression);
  if (nullable) return row[nullable[1]] === null;
  const membership = /^(\w+)\.in\.\((.*)\)$/s.exec(expression);
  if (!membership) throw new Error(`Unsupported inventory filter: ${expression}`);
  return JSON.parse(`[${membership[2]}]`).includes(row[membership[1]]);
}

function compareRows(left, right, order) {
  for (const clause of order.split(",")) {
    const [column, direction] = clause.split(".");
    const a = left[column],
      b = right[column];
    if (a === b) continue;
    if (a === null) return 1;
    if (b === null) return -1;
    let comparison;
    if (column === "sales_amount_90d") comparison = compareAmounts(a, b);
    else if (column.endsWith("_urgency")) comparison = Number(a) - Number(b);
    else comparison = a < b ? -1 : a > b ? 1 : 0;
    if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
  }
  return 0;
}

export async function mockInventory(page, rows) {
  const state = {
    rows,
    requests: [],
    optionRequests: [],
    captureRequests: [],
    availabilityRequests: [],
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
  await page.route(
    "https://example.invalid/rest/v1/rpc/inventory_filter_options",
    async (route) => {
      const replies = createReplies(route);
      if (route.request().method() === "OPTIONS") return replies.reply({});
      state.optionRequests.push(route.request().postDataJSON());
      if (state.failed) return replies.reply({ message: "private database details" }, 503);
      const values = (column) => [...new Set(state.rows.map((row) => row[column]))];
      return replies.reply({
        skus: values("sku"),
        health_statuses: values("health_status"),
        recommendations: values("recommended_action"),
      });
    },
  );
  await page.route("https://example.invalid/rest/v1/latest_inventory_items?**", async (route) => {
    const replies = createReplies(route);
    if (route.request().method() === "OPTIONS") return replies.reply({});
    const params = new URL(route.request().url()).searchParams;
    const availability = params.get("select") === "capture_id";
    (availability ? state.availabilityRequests : state.requests).push(params);
    if (state.failed) return replies.reply({ message: "private database details" }, 503);
    const exact = (column) => (params.has(column) ? params.get(column).slice(3) : null);
    const matching = state.rows
      .filter(
        (row) =>
          (exact("marketplace_name") === null ||
            row.marketplace_name === exact("marketplace_name")) &&
          (!params.has("and") || matches(row, "and" + params.get("and"))),
      )
      .sort((left, right) => compareRows(left, right, params.get("order") ?? "sku.asc"));
    const offset = Number(params.get("offset"));
    return replies.csvReply(
      availability ? ["capture_id"] : INVENTORY_COLUMNS,
      matching.slice(offset, offset + Number(params.get("limit"))),
      matching.length,
      offset,
    );
  });
  return state;
}
