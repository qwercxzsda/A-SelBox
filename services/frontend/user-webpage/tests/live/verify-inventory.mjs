/** Opt-in, unmocked browser check driven by the disposable real-inventory verifier. */
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { formatExactDecimal, formatExactMoney } from "../../src/decimal.ts";
import { parseCsv } from "../../src/api/csv.ts";
import { reviewInventoryLayout } from "./inventory-ui-review.mjs";

const QUANTITIES = [
  ["Available", "available_quantity"],
  ["Supply at FBA", "fba_supply_quantity"],
  ["Inbound", "inbound_quantity"],
  ["Inbound working", "inbound_working_quantity"],
  ["Inbound shipped", "inbound_shipped_quantity"],
  ["Inbound received", "inbound_received_quantity"],
  ["Reserved", "reserved_quantity"],
  ["Reserved transfer", "reserved_transfer_quantity"],
  ["Reserved processing", "reserved_processing_quantity"],
  ["Reserved customer orders", "reserved_customer_order_quantity"],
  ["Unfulfillable", "unfulfillable_quantity"],
  ["Units shipped", "units_shipped_90d"],
  ["Minimum inventory (units)", "minimum_inventory_units"],
  ["Days of supply", "days_of_supply"],
  ["Total days of supply", "total_days_of_supply"],
  ["Recommended ship-in units", "recommended_ship_in_units"],
];
const RECOMMENDATION_LABELS = new Map([
  ["EditListing", "Edit listing"],
  ["SendToFBA", "Send to FBA"],
  ["GoToRestock", "Restock"],
  ["NoExcessInventory", "No excess inventory"],
  ["NoActionRequired", "No action required"],
  ["AdvertiseListing", "Advertise listing"],
]);

const itemCount = (count) => `${count} inventory ${count === 1 ? "item" : "items"}`;
const inventoryRegion = (page) =>
  page.getByRole("region", { name: "Inventory items", exact: true });
const metric = (row, label) => row.getByText(label, { exact: true }).locator("..").locator("dd");

/** Bind each action to its actual response; a matching cached count is not a completion signal. */
async function readAfter(page, expectedParams, action) {
  readStep = "waiting-response";
  const ready = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/rest/v1/latest_inventory_items" &&
        Object.entries(expectedParams).every(([key, value]) => url.searchParams.get(key) === value)
      );
    },
    { timeout: 30000 },
  );
  await action();
  const response = await ready;
  if (!response.ok()) throw new Error("Inventory request failed");
  const rows = parseCsv(await response.text());
  readStep = "rendering-response";
  readRowCount = rows.length;
  await expect(inventoryRegion(page).locator(".inventory-sku")).toHaveText(
    rows.map((row) => row.sku),
  );
  await expect(
    page.getByRole("status").filter({ hasText: /^(Loading|Updating) inventory…$/ }),
  ).toHaveCount(0);
  return rows;
}

async function verifyCatalog(page, account) {
  await expect(page.getByText(itemCount(account.count), { exact: true }).first()).toBeVisible();
  let rows = await readAfter(page, { limit: "100", offset: "0" }, () =>
    page.getByLabel("Rows", { exact: true }).selectOption("100"),
  );
  const visible = rows.map((row) => row.sku);
  while (visible.length < account.count) {
    const offset = visible.length;
    rows = await readAfter(page, { limit: "100", offset: String(offset) }, () =>
      page
        .getByRole("navigation", { name: "Inventory pagination, top", exact: true })
        .getByRole("button", { name: "Next", exact: true })
        .click(),
    );
    if (rows.length === 0) throw new Error("Inventory pages did not advance");
    visible.push(...rows.map((row) => row.sku));
  }
  if (JSON.stringify([...visible].sort()) !== JSON.stringify([...account.skus].sort()))
    throw new Error("Visible SKU set mismatch");
}

function exactFilter(value) {
  return "eq." + value;
}

async function verifyMetrics(page, sample) {
  const row = inventoryRegion(page).locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".inventory-sku")).toHaveText(sample.sku);
  // Python's CSV reader supplies empty cells as strings. The API parser preserves SQL NULL.
  const field = (name) => (sample[name] === "" || sample[name] === null ? null : sample[name]);
  await row.focus();
  await row.press("Enter");
  const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
  await expect(detail).toBeVisible();
  for (const [label, name] of QUANTITIES)
    await expect(metric(detail, label)).toHaveText(formatExactDecimal(field(name)));
  await expect(metric(detail, "Sales")).toHaveText(
    formatExactMoney(field("sales_amount_90d"), field("currency")),
  );
  await expect(metric(detail, "Recommended ship-in date")).toHaveText(
    field("recommended_ship_in_date") ?? "—",
  );
  await expect(detail.locator(".inventory-health-label")).toHaveText(field("health_status") ?? "—");
  await expect(detail.locator(".inventory-action-label")).toHaveText(
    RECOMMENDATION_LABELS.get(field("recommended_action")) ?? field("recommended_action") ?? "—",
  );
  const source = detail.getByRole("button", { name: "Source capture", exact: true });
  if ((await source.getAttribute("aria-expanded")) !== "true") await source.click();
  await expect(metric(detail, "Snapshot date")).toHaveText(field("snapshot_date") ?? "—");
  await detail.getByRole("button", { name: "Close inventory details", exact: true }).click();
}

async function verifyLightweightCheck(page, sample) {
  let inventoryReads = 0;
  const countRead = (request) => {
    if (new URL(request.url()).pathname === "/rest/v1/latest_inventory_items") inventoryReads += 1;
  };
  page.on("request", countRead);
  try {
    const ready = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/rest/v1/rpc/workspace_revisions" &&
        url.searchParams.get("p_sources")?.includes("inventory")
      );
    });
    await page.clock.fastForward(60_000);
    const response = await ready;
    if (!response.ok()) throw new Error("Inventory revision check failed");
    const snapshot = await response.json();
    if (typeof snapshot.revisions?.inventory !== "string")
      throw new Error("Inventory revision token missing");
    await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
    await verifyMetrics(page, sample);
    if (inventoryReads !== 0) throw new Error("Unchanged inventory triggered a data read");
  } finally {
    page.off("request", countRead);
  }
}

let stage = "start";
let readStep = "none";
let readRowCount = 0;
let browser;
let server;
const failures = [];
const layoutReviews = [];
try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input);
  process.env.VITE_SUPABASE_URL = config.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = config.anonKey;
  server = await createServer({
    server: { host: "127.0.0.1", port: 5179, strictPort: true },
    logLevel: "silent",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const [accountIndex, account] of config.accounts.entries()) {
    const role = account.role === "operator" ? "operator" : "member";
    stage = role + ":login";
    const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
    const page = await context.newPage();
    await page.clock.install();
    page.setDefaultTimeout(30000);
    page.on("pageerror", () => failures.push("pageerror"));
    page.on("response", (response) => {
      if (response.url().startsWith(config.apiUrl) && response.status() >= 400)
        failures.push("http:" + response.status());
    });
    await page.goto("http://127.0.0.1:5179");
    await page.getByLabel(/^Email/).fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    stage = role + ":inventory";
    await verifyCatalog(page, account);
    stage = role + ":responsive-review";
    layoutReviews.push({
      role,
      viewports: await reviewInventoryLayout(page, `${role}-${accountIndex}`),
    });
    stage = role + ":sku-filter";
    await inventoryRegion(page).getByRole("button", { name: "SKU", exact: true }).click();
    const skuSearch = page.getByLabel("Search sku", { exact: true });
    if (await skuSearch.count()) await skuSearch.fill(account.sample.sku);
    const skuFilter = `(sku.in.(${JSON.stringify(account.sample.sku)}))`;
    await readAfter(page, { and: skuFilter, offset: "0" }, () =>
      page.getByRole("checkbox", { name: account.sample.sku, exact: true }).check(),
    );
    await page.keyboard.press("Escape");
    stage = role + ":marketplace-filter";
    await readAfter(
      page,
      {
        and: skuFilter,
        marketplace_name: exactFilter(account.sample.marketplace_name),
        offset: "0",
      },
      () =>
        page
          .getByLabel("Marketplace", { exact: true })
          .selectOption(account.sample.marketplace_name),
    );
    await expect(page.getByText("1 inventory item", { exact: true }).first()).toBeVisible();
    stage = role + ":metrics";
    await verifyMetrics(page, account.sample);
    stage = role + ":lightweight-refresh";
    await verifyLightweightCheck(page, account.sample);
    await expect(page.getByRole("button", { name: /Send to FBA|Create shipment/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Refresh inventory|Retry inventory/i }),
    ).toHaveCount(0);
    if (account.role === "operator")
      await page.screenshot({ path: "/evidence/inventory-live.png", fullPage: true });
    await context.close();
  }
  if (failures.length) throw new Error("Unexpected browser/API errors");
  process.stdout.write(
    JSON.stringify({
      browser_verified: true,
      accounts: config.accounts.length,
      real_auth_and_rest: true,
      exact_sku_and_marketplace_filters: true,
      quantities_match_database: true,
      report_fields_checked_per_sample: 22,
      automatic_refresh: true,
      unchanged_inventory_checks_are_lightweight: true,
      responsive_layout_reviews: layoutReviews,
      browser_errors: 0,
    }) + "\n",
  );
} catch {
  // Never print assertion diffs, page text, response bodies, credentials, or source SKU values.
  process.stdout.write(
    JSON.stringify({
      browser_verified: false,
      stage,
      readStep,
      readRowCount,
      failure_count: failures.length,
    }) + "\n",
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}
