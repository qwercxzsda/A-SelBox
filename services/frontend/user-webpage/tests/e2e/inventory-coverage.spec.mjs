import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { columnTrigger } from "./table-actions.mjs";

const capture = (overrides = {}) => ({
  capture_id: "capture-us",
  marketplace_name: "Amazon.com",
  capture_date: "2026-10-03",
  report_created_at: "2026-10-03T14:00:00Z",
  preprocessed_at: "2026-10-17T04:00:00Z",
  ...overrides,
});
const items = (page) => page.getByRole("region", { name: "Inventory items", exact: true });
const coverage = (page) =>
  page.getByRole("region", { name: "Inventory snapshot coverage", exact: true });
const chips = (page) => page.getByRole("group", { name: "Applied inventory filters", exact: true });

async function setup(page, rows, role = "member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  const inventory = await mockInventory(page, rows);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  return { fixture, inventory };
}

async function filter(page, column, value) {
  await columnTrigger(items(page), column).click();
  const menu = page.getByRole("dialog", { name: `${column} options`, exact: true });
  await menu.getByRole("checkbox", { name: value, exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

test("old inventory exposes source age before opening metadata and separates processing time", async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
  const { inventory } = await setup(page, [
    inventoryRow("STALE", {
      ...capture(),
      snapshot_date: "2026-10-03",
      available_quantity: "0",
    }),
  ]);
  await expect(coverage(page)).toContainText("Report 2026-10-03 · 15 days old");
  await expect(coverage(page).getByText("Overdue report", { exact: true })).toBeVisible();
  await expect(items(page)).toContainText("Stock as of 2026-10-03 · 15 days old");
  await expect(items(page).getByText("Available", { exact: true }).locator("..")).toHaveText(
    "Available0",
  );
  await items(page).locator("tbody tr").first().click();
  const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
  await expect(detail).toContainText("Stock as of 2026-10-03 · 15 days old");
  await expect(detail).toContainText("Amazon report created 2026-10-03 14:00:00 UTC");
  await expect(detail).toContainText("Processed 2026-10-17 04:00:00 UTC");
  await expect(detail).toContainText("processing does not refresh the source stock");
  await expect(detail.getByRole("button", { name: "Source capture", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({
    path: testInfo.outputPath("inventory-age-desktop.png"),
    animations: "disabled",
  });
  expect(inventory.captureRequests).toHaveLength(2);
  await expect(
    page.getByRole("button", { name: /Refresh inventory|Send to FBA|Create shipment/ }),
  ).toHaveCount(0);
});

test("empty imported reports and unavailable marketplace coverage have different messages", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  const inventory = await mockInventory(page, []);
  inventory.captures = [capture()];
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByText(
      "The latest imported snapshots contain no inventory items in this marketplace scope.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.de");
  await expect(
    page.getByText("No inventory snapshot has been imported for Amazon.de.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Marketplace", { exact: true }).locator('option[value="Amazon.de"]'),
  ).toHaveText("Amazon.de — no snapshot");
  await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.com");
  await expect(
    page.getByText(
      "The latest imported snapshots contain no inventory items in this marketplace scope.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("members see authorized-item availability without a global stock-empty claim", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "member";
  const inventory = await mockInventory(page, []);
  inventory.captures = [capture()];
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByText(
      "An inventory snapshot is available, but no items from it are assigned to your company.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/snapshots contain no inventory items/)).toHaveCount(0);
  await expect(coverage(page)).toContainText("Amazon.com");
});

test("active filters show each value, survive F5 and clear individually without discarding other criteria", async ({
  page,
}, testInfo) => {
  const { inventory } = await setup(page, [
    inventoryRow("OUT", { health_status: "Out of stock", recommended_action: "SendToFBA" }),
    inventoryRow("LISTING", { health_status: "Healthy", recommended_action: "EditListing" }),
    inventoryRow("UNKNOWN"),
  ]);
  await filter(page, "Inventory health status", "Out of stock");
  await filter(page, "Recommendation", "Edit listing");
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  await expect(chips(page)).toContainText("Health: Out of stock");
  await expect(chips(page)).toContainText("Recommendation: Edit listing");
  expect(inventory.availabilityRequests).toHaveLength(1);
  expect(inventory.availabilityRequests[0].get("and")).toBeNull();
  await page.reload();
  await expect(
    chips(page).getByRole("button", { name: "Remove Health: Out of stock", exact: true }),
  ).toBeVisible();
  await chips(page)
    .getByRole("button", { name: "Remove Health: Out of stock", exact: true })
    .click();
  await expect(items(page).locator(".inventory-sku")).toHaveText(["LISTING"]);
  await expect(chips(page)).toContainText("Recommendation: Edit listing");
  await chips(page)
    .getByRole("button", { name: "Remove Recommendation: Edit listing", exact: true })
    .click();
  await expect(items(page).locator(".inventory-sku")).toHaveCount(3);
  await filter(page, "Inventory health status", "Unavailable");
  await expect(
    chips(page).getByRole("button", { name: "Remove Health: Unavailable", exact: true }),
  ).toBeVisible();
  await expect(items(page).locator(".inventory-sku")).toHaveText(["UNKNOWN"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("inventory-filters-phone.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
});

test("coverage failures do not become a no-snapshot claim and retry with lightweight checks", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const inventory = await mockInventory(page, []);
  inventory.coverageFailed = true;
  inventory.captures = [capture()];
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not check inventory snapshot coverage",
  );
  await expect(page.getByText(/No inventory snapshot has been imported/)).toHaveCount(0);
  inventory.coverageFailed = false;
  await page.clock.fastForward(60_000);
  await expect(coverage(page)).toContainText("Amazon.com");
  const reads = inventory.captureRequests.length;
  await page.clock.fastForward(60_000);
  expect(inventory.captureRequests).toHaveLength(reads);
  expect(fixture.revisionRequests.length).toBeGreaterThan(0);
});

test("age updates at midnight without reloading successful inventory pages", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-05T23:59:30Z") });
  const { inventory } = await setup(page, [
    inventoryRow("AGING", { ...capture(), snapshot_date: null }),
  ]);
  await expect(coverage(page)).toContainText("2 days old");
  await expect(items(page)).toContainText("Stock date unavailable · Report 2026-10-03");
  await expect(coverage(page).getByText("Overdue report", { exact: true })).toHaveCount(0);
  const reads = inventory.requests.length;
  const captureReads = inventory.captureRequests.length;
  await page.clock.fastForward(61_000);
  await expect(coverage(page)).toContainText("3 days old");
  await expect(coverage(page).getByText("Overdue report", { exact: true })).toBeVisible();
  expect(inventory.requests).toHaveLength(reads);
  expect(inventory.captureRequests).toHaveLength(captureReads);
});

test("sales sorting explains original currencies at the point of comparison", async ({ page }) => {
  await setup(page, [
    inventoryRow("YEN", { sales_amount_90d: "90000", currency: "JPY" }),
    inventoryRow("DOLLARS", { sales_amount_90d: "1000", currency: "USD" }),
  ]);
  await expect(
    items(page).getByText("Original currencies · no conversion", { exact: true }),
  ).toBeVisible();
  await columnTrigger(items(page), "Sales · last 90 days").click();
  await page.getByRole("button", { name: "Highest first", exact: true }).click();
  await expect(
    page.getByRole("note").filter({ hasText: "Sales ordering compares original currency amounts" }),
  ).toBeVisible();
  await expect(items(page).locator(".inventory-sku")).toHaveText(["YEN", "DOLLARS"]);
  await expect(items(page)).toContainText("90,000.00 JPY");
  await expect(items(page)).toContainText("1,000.00 USD");
});
