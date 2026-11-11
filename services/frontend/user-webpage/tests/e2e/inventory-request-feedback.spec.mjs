import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

const topPager = (page) =>
  page.getByRole("navigation", { name: "Inventory pagination, top", exact: true });

test("inventory waits for the complete dataset before displaying filtered results", async ({
  page,
}) => {
  await mockSupabase(page);
  await mockInventory(page, [inventoryRow("NEEDLE"), inventoryRow("OTHER")]);
  const release = deferred();
  await page.route("**/latest_inventory_items?**", async (route) => {
    if (route.request().method() === "GET") await release.promise;
    await route.fallback();
  });
  try {
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await page.getByLabel("Search", { exact: true }).fill("NEEDLE");
    await expect(page.locator(".inventory-sku")).toHaveCount(0);
    const header = page.locator(".workspace-header");
    await expect(header.getByRole("status")).toHaveText("Loading…");
    await expect(page.getByText("Loading inventory…", { exact: true })).toHaveCount(0);
    const controls = await page
      .getByRole("group", { name: "Inventory controls", exact: true })
      .boundingBox();
    await expect(topPager(page)).not.toContainText("0–0 of 0 inventory items");
    release.resolve();
    await expect(page.locator(".inventory-sku")).toHaveText(["NEEDLE"]);
    await expect(topPager(page)).toContainText("1–1 of 1 inventory items");
    await expect(header.getByRole("status").filter({ hasText: "Loading…" })).toHaveCount(0);
    expect(
      (await page.getByRole("group", { name: "Inventory controls", exact: true }).boundingBox()).y,
    ).toBeCloseTo(controls.y, 0);
  } finally {
    release.resolve();
  }
});

test("a failed complete inventory read does not claim inventory is empty", async ({ page }) => {
  await mockSupabase(page);
  const inventory = await mockInventory(page, [inventoryRow("NEEDLE")]);
  inventory.failed = true;
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load inventory.");
  await expect(topPager(page)).toContainText("Inventory unavailable");
  await expect(topPager(page)).not.toContainText("0–0 of 0 inventory items");
});

test("loaded inventory paging and search do not need another database read", async ({ page }) => {
  await mockSupabase(page);
  const inventory = await mockInventory(
    page,
    Array.from({ length: 30 }, (_, index) =>
      inventoryRow(`ITEM-${String(index).padStart(2, "0")}`),
    ),
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.locator(".inventory-sku")).toHaveCount(25);
  await expect(topPager(page)).toContainText("1–25 of 30 inventory items");
  const reads = inventory.requests.length;
  inventory.failed = true;
  await topPager(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".inventory-sku")).toHaveCount(5);
  await expect(topPager(page)).toContainText("26–30 of 30 inventory items");
  await page.getByLabel("Search", { exact: true }).fill("ITEM-01");
  await expect(page.locator(".inventory-sku")).toHaveText(["ITEM-01"]);
  await expect(topPager(page)).toContainText("1–1 of 1 inventory items");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(inventory.requests).toHaveLength(reads);
});
