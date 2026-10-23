import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { createReplies } from "./mocks/http.mjs";

const topPager = (page) =>
  page.getByRole("navigation", { name: "Inventory pagination, top", exact: true });

test("inventory search reports waiting for its catalog instead of an empty result", async ({
  page,
}, testInfo) => {
  await mockSupabase(page);
  await mockInventory(page, [inventoryRow("NEEDLE"), inventoryRow("OTHER")]);
  const release = deferred();
  await page.route("**/rpc/inventory_filter_options", async (route) => {
    if (route.request().method() === "POST") await release.promise;
    await route.fallback();
  });
  try {
    await signIn(page);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(page.locator(".inventory-sku")).toHaveCount(2);
    await page.getByLabel("Search", { exact: true }).fill("NEEDLE");
    await expect(page.locator(".inventory-sku")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Loading inventory…" })).toBeVisible();
    await expect(topPager(page)).toContainText("Loading inventory…");
    await expect(topPager(page)).not.toContainText("0 inventory items");
    await page.screenshot({
      path: testInfo.outputPath("inventory-catalog-wait.png"),
      animations: "disabled",
    });
    release.resolve();
    await expect(page.locator(".inventory-sku")).toHaveText(["NEEDLE"]);
    await expect(topPager(page)).toContainText("1 inventory item");
  } finally {
    release.resolve();
  }
});

test("a catalog failure keeps unfiltered inventory available while explaining blocked search", async ({
  page,
}) => {
  await mockSupabase(page);
  const inventory = await mockInventory(page, [inventoryRow("NEEDLE"), inventoryRow("OTHER")]);
  await page.route("**/rpc/inventory_filter_options", async (route) => {
    const replies = createReplies(route);
    await replies.reply({}, route.request().method() === "OPTIONS" ? 200 : 503);
  });
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load inventory filter options.");
  await expect(page.locator(".inventory-sku")).toHaveCount(2);
  await expect(topPager(page)).toContainText("2 inventory items");
  await page.getByLabel("Search", { exact: true }).fill("NEEDLE");
  await expect(topPager(page)).toContainText("Inventory unavailable");
  await expect(page.getByRole("status").filter({ hasText: "Loading inventory…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".inventory-sku")).toHaveCount(2);
  await expect(topPager(page)).toContainText("2 inventory items");
  expect(inventory.requests).toHaveLength(1);
});

test("an unavailable inventory page does not claim that inventory is empty", async ({ page }) => {
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
  inventory.failed = true;
  await topPager(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load inventory.");
  await expect(topPager(page)).toContainText("Inventory unavailable");
  await expect(topPager(page)).not.toContainText("0 inventory items");
  await topPager(page).getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator(".inventory-sku")).toHaveCount(25);
  await expect(topPager(page)).toContainText("30 inventory items");
});
