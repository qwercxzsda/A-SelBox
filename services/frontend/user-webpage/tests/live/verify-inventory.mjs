/** Opt-in, unmocked browser check driven by the disposable real-inventory verifier. */
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { formatExactDecimal, formatMoney } from "../../src/decimal.ts";
import { recommendationLabel } from "../../src/inventory-options.ts";
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
const itemCount = (count) => `${count} inventory ${count === 1 ? "item" : "items"}`;
const inventoryRegion = (page) =>
  page.getByRole("region", { name: "Inventory items", exact: true });
const metric = (row, label) => row.getByText(label, { exact: true }).locator("..").locator("dd");

/** Inventory filtering and pagination operate on the complete browser snapshot. */
async function visiblePage(page, pageIndex, totalCount) {
  readStep = "rendering-page";
  const pagination = page.getByRole("navigation", {
    name: "Inventory pagination, top",
    exact: true,
  });
  await expect(
    pagination.getByRole("form", {
      name: `Page ${pageIndex + 1} of ${Math.max(1, Math.ceil(totalCount / 100))}`,
      exact: true,
    }),
  ).toBeVisible();
  const skus = inventoryRegion(page).locator(".inventory-sku");
  await expect(skus).toHaveCount(Math.min(100, totalCount - pageIndex * 100));
  await expect(
    page.getByRole("status").filter({ hasText: /^(Loading|Updating) inventory…$/ }),
  ).toHaveCount(0);
  const values = await skus.allTextContents();
  readRowCount = values.length;
  return values;
}

async function verifyCatalog(page, account) {
  await expect(page.getByText(itemCount(account.count), { exact: true }).first()).toBeVisible();
  await page.getByLabel("Rows", { exact: true }).selectOption("100");
  const visible = await visiblePage(page, 0, account.count);
  let pageIndex = 0;
  while (visible.length < account.count) {
    await page
      .getByRole("navigation", { name: "Inventory pagination, top", exact: true })
      .getByRole("button", { name: "Next", exact: true })
      .click();
    pageIndex += 1;
    const rows = await visiblePage(page, pageIndex, account.count);
    if (rows.length === 0) throw new Error("Inventory pages did not advance");
    visible.push(...rows);
  }
  if (JSON.stringify([...visible].sort()) !== JSON.stringify([...account.skus].sort()))
    throw new Error("Visible SKU set mismatch");
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
    formatMoney(field("sales_amount_90d"), field("currency")),
  );
  await expect(metric(detail, "Recommended ship-in date")).toHaveText(
    field("recommended_ship_in_date") ?? "—",
  );
  await expect(detail.locator(".inventory-health-label")).toHaveText(field("health_status") ?? "—");
  await expect(detail.locator(".inventory-action-label")).toHaveText(
    field("recommended_action") === null ? "—" : recommendationLabel(field("recommended_action")),
  );
  const source = detail.getByRole("button", { name: "Additional details", exact: true });
  if ((await source.getAttribute("aria-expanded")) !== "true") await source.click();
  await expect(
    detail
      .getByRole("table", { name: "Additional record details", exact: true })
      .getByRole("row")
      .filter({ hasText: "Snapshot date" })
      .getByRole("cell")
      .last(),
  ).toHaveText(field("snapshot_date") ?? "—");
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
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = config.publishableKey;
  server = await createServer({
    server: { host: "127.0.0.1", port: 5179, strictPort: true },
    logLevel: "silent",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const [accountIndex, account] of config.accounts.entries()) {
    const role = account.role === "administrator" ? "administrator" : "member";
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
    await page.getByRole("checkbox", { name: account.sample.sku, exact: true }).check();
    await expect(inventoryRegion(page).locator(".inventory-sku")).toHaveText(
      account.skus.filter((sku) => sku === account.sample.sku).slice(0, 100),
    );
    await page.keyboard.press("Escape");
    stage = role + ":marketplace-filter";
    await page.getByRole("button", { name: "Marketplace", exact: true }).click();
    const marketplaceMenu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
    await marketplaceMenu
      .getByRole("checkbox", { name: account.sample.marketplace_name, exact: true })
      .check();
    await marketplaceMenu.getByRole("button", { name: "Close options", exact: true }).click();
    await expect(page.getByText("1–1 of 1 inventory items", { exact: true }).first()).toBeVisible();
    stage = role + ":metrics";
    await verifyMetrics(page, account.sample);
    stage = role + ":lightweight-refresh";
    await verifyLightweightCheck(page, account.sample);
    await expect(page.getByRole("button", { name: /Send to FBA|Create shipment/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Refresh inventory|Retry inventory/i }),
    ).toHaveCount(0);
    if (account.role === "administrator")
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
