import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { columnTrigger, openColumn, selectColumnOptions } from "./table-actions.mjs";

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
  await expect(coverage(page)).toHaveCount(0);
  await expect(page.getByText("Latest imported reports", { exact: true })).toHaveCount(0);
  await expect(items(page).locator(".inventory-source-date")).toHaveText(
    "2026-10-03 · 15d ago · Out of date",
  );
  await expect(items(page).locator(".inventory-source-date .mantine-Badge-root")).toHaveCount(0);
  await expect(items(page).getByText("Available", { exact: true }).locator("..")).toHaveText(
    "Available0",
  );
  await items(page).locator("tbody tr").first().click();
  const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
  await expect(detail).toContainText("Stock as of 2026-10-03 · 15 days old · Out of date");
  const additional = detail.getByRole("button", { name: "Additional details", exact: true });
  await expect(additional).toHaveAttribute("aria-expanded", "false");
  await expect(detail.getByText("Processed", { exact: true })).toHaveCount(0);
  await additional.click();
  const metadata = detail.getByRole("table", { name: "Additional record details", exact: true });
  await expect(metadata.getByRole("row").filter({ hasText: "Report created" })).toContainText(
    "2026-10-03 14:00:00 UTC",
  );
  await expect(metadata.getByRole("row").filter({ hasText: "Processed" })).toContainText(
    "2026-10-17 04:00:00 UTC",
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
  await selectColumnOptions(page, "Marketplace", ["Amazon.de — no snapshot"]);
  await expect(
    page.getByText("No inventory snapshot has been imported for Amazon.de.", { exact: true }),
  ).toBeVisible();
  const marketplaceMenu = await openColumn(page, "Marketplace");
  await expect(
    marketplaceMenu.getByRole("checkbox", { name: "Amazon.de — no snapshot", exact: true }),
  ).toBeChecked();
  await marketplaceMenu.getByRole("button", { name: "Clear marketplace", exact: true }).click();
  await marketplaceMenu.getByRole("button", { name: "Close options", exact: true }).click();
  await selectColumnOptions(page, "Marketplace", ["Amazon.com"]);
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
  await expect(coverage(page)).toHaveCount(0);
});

test("active filters show each value, survive F5 and clear individually without discarding other criteria", async ({
  page,
}, testInfo) => {
  const { inventory } = await setup(page, [
    inventoryRow("OUT", { health_status: "Out of stock", recommended_action: "SendToFBA" }),
    inventoryRow("LISTING", { health_status: "Healthy", recommended_action: "Edit listing" }),
    inventoryRow("UNKNOWN"),
  ]);
  await filter(page, "Inventory health status", "Out of stock");
  await filter(page, "Recommendation", "Edit listing");
  await expect(
    page.getByText("No inventory matches these filters.", { exact: true }),
  ).toBeVisible();
  await expect(chips(page)).toContainText("Health: Out of stock");
  await expect(chips(page)).toContainText("Recommendation: Edit listing");
  expect(inventory.requests).toHaveLength(2);
  expect(inventory.requests.every((request) => !request.has("and"))).toBe(true);
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

test("availability failures do not become a no-snapshot claim and retry with lightweight checks", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await mockSupabase(page);
  const inventory = await mockInventory(page, []);
  inventory.coverageFailed = true;
  inventory.captures = [capture()];
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not check inventory availability");
  await expect(page.getByText(/No inventory snapshot has been imported/)).toHaveCount(0);
  inventory.coverageFailed = false;
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(
      "An inventory snapshot is available, but no items from it are assigned to your company.",
      { exact: true },
    ),
  ).toBeVisible();
  const reads = inventory.captureRequests.length;
  await page.clock.fastForward(60_000);
  expect(inventory.captureRequests).toHaveLength(reads);
  expect(fixture.revisionRequests.length).toBeGreaterThan(0);
});

test("visible inventory keeps its own date warning when the capture lookup fails", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
  await mockSupabase(page);
  const inventory = await mockInventory(page, [
    inventoryRow("AVAILABLE", { ...capture(), snapshot_date: "2026-10-03" }),
  ]);
  inventory.coverageFailed = true;
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(items(page).locator(".inventory-source-date")).toHaveText(
    "2026-10-03 · 15d ago · Out of date",
  );
  await page.clock.fastForward(2_000);
  await expect.poll(() => inventory.captureRequests.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(coverage(page)).toHaveCount(0);
  await expect(page.getByText("Checking inventory availability…", { exact: true })).toHaveCount(0);
});

test("age updates at marketplace midnight without reloading successful inventory pages", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-06T06:59:30Z") });
  const { inventory } = await setup(page, [
    inventoryRow("AGING", { ...capture(), snapshot_date: null }),
  ]);
  await expect(coverage(page)).toHaveCount(0);
  await expect(items(page).locator(".inventory-source-date")).toHaveText(
    "Report 2026-10-03 · 2d ago",
  );
  await expect(items(page)).not.toContainText("Out of date");
  const reads = inventory.requests.length;
  const captureReads = inventory.captureRequests.length;
  await page.clock.fastForward(61_000);
  await expect(items(page).locator(".inventory-source-date")).toHaveText(
    "Report 2026-10-03 · 3d ago · Out of date",
  );
  expect(inventory.requests).toHaveLength(reads);
  expect(inventory.captureRequests).toHaveLength(captureReads);
});

test("phone inventory keeps next-local-day stock fresh while warning about genuinely future dates", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2026-11-05T17:15:00Z") });
  await setup(
    page,
    [
      ["JP", "Amazon.co.jp"],
      ["AU", "Amazon.com.au"],
      ["SG", "Amazon.sg"],
      ["US", "Amazon.com"],
    ].map(([code, marketplace]) =>
      inventoryRow(`LOCAL-${code}`, {
        ...capture({ capture_id: `capture-${code}`, marketplace_name: marketplace }),
        capture_date: code === "US" ? "2026-11-05" : "2026-11-06",
        snapshot_date: "2026-11-06",
        report_created_at: "2026-11-05T17:15:00Z",
      }),
    ),
  );
  for (const code of ["JP", "AU", "SG"]) {
    const row = items(page)
      .locator("tbody tr")
      .filter({ hasText: `LOCAL-${code}` });
    await expect(row).toContainText("2026-11-06 · Today");
    await expect(row).not.toContainText("Future date");
    await expect(row).not.toContainText("Out of date");
  }
  await expect(coverage(page)).toHaveCount(0);
  const future = items(page).locator("tbody tr").filter({ hasText: "LOCAL-US" });
  await expect(future).toContainText("Future date");
  await page.screenshot({
    path: testInfo.outputPath("inventory-local-day-phone.png"),
    fullPage: true,
    animations: "disabled",
  });
  await items(page).locator("tbody tr").filter({ hasText: "LOCAL-JP" }).click();
  const detail = page.getByRole("dialog", { name: "Inventory details", exact: true });
  await expect(detail).toContainText("Stock as of 2026-11-06 · Today");
  await detail.getByRole("button", { name: "Additional details", exact: true }).click();
  await expect(
    detail
      .getByRole("table", { name: "Additional record details", exact: true })
      .getByRole("row")
      .filter({ hasText: "Report created" }),
  ).toContainText("2026-11-05 17:15:00 UTC");
  await page.screenshot({
    path: testInfo.outputPath("inventory-local-day-details-phone.png"),
    animations: "disabled",
  });
});

test("sales sorting explains original currencies at the point of comparison", async ({ page }) => {
  await setup(page, [
    inventoryRow("YEN", { sales_amount_90d: "90000", currency: "JPY" }),
    inventoryRow("DOLLARS", { sales_amount_90d: "1000", currency: "USD" }),
  ]);
  await expect(
    items(page).getByText("Original currencies · no conversion", { exact: true }),
  ).toHaveCount(0);
  await columnTrigger(items(page), "Sales · last 90 days").click();
  await page.getByRole("button", { name: "Highest first", exact: true }).click();
  await items(page).getByRole("button", { name: "Sales amount help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Sales amount help", exact: true });
  await expect(help).toContainText("Sales use original currencies without conversion.");
  await expect(help).toContainText("Select one marketplace before comparing amounts.");
  await help.getByRole("button", { name: "Close Sales amount help", exact: true }).click();
  await expect(items(page).locator(".inventory-sku")).toHaveText(["YEN", "DOLLARS"]);
  await expect(items(page)).toContainText("90,000.00 JPY");
  await expect(items(page)).toContainText("1,000.00 USD");
});
