import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { columnTrigger } from "./table-actions.mjs";

async function openInventory(page) {
  await mockSupabase(page);
  await mockInventory(
    page,
    Array.from({ length: 55 }, (_, index) =>
      inventoryRow(`QA-${String(index + 1).padStart(3, "0")}`, {
        health_status: index % 2 ? "Healthy" : "Low stock",
        recommended_action: "Restock",
      }),
    ),
  );
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show transactions for QA-001" })).toBeVisible();
  await expect(page.getByText("Latest imported reports", { exact: true })).toBeVisible();
}

test("inventory column controls reach recommendations without visiting the final row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInventory(page);
  const right = page.getByRole("button", { name: "Scroll table right", exact: true });
  const left = page.getByRole("button", { name: "Scroll table left", exact: true });
  const region = page.getByRole("region", { name: "Inventory items", exact: true });
  await expect(left).toBeDisabled();
  const { remaining, step } = await region.evaluate((element) => ({
    remaining: element.scrollWidth - element.clientWidth,
    step: element.clientWidth * 0.75,
  }));
  for (let index = 0; index < Math.ceil(remaining / step); index += 1) {
    await right.click();
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeGreaterThanOrEqual(Math.min(remaining, step * (index + 1)) - 1);
  }
  await expect(right).toBeDisabled();
  const recommendation = columnTrigger(region, "Recommendation");
  const bounds = await recommendation.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await recommendation.scrollIntoViewIfNeeded();
  await expect(recommendation).toBeInViewport();
  await expect(
    region.getByRole("button", { name: "Show transactions for QA-025" }),
  ).not.toBeInViewport();
  await left.click();
  await expect(right).toBeEnabled();
});

test("bottom paging returns to the first inventory rows when a page is cached", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInventory(page);
  const bottom = page.getByRole("navigation", { name: "Pagination", exact: true });
  const top = page.getByRole("navigation", { name: "Inventory pagination, top", exact: true });
  await bottom.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show transactions for QA-026" })).toBeVisible();
  await bottom.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(top).toBeInViewport();
  await expect(page.getByRole("button", { name: "Show transactions for QA-001" })).toBeInViewport();
  await expect(page.locator(".inventory-page-start")).toBeFocused();
});

test("mobile inventory keeps marketplace readable and preserves independent filter removal", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInventory(page);
  const marketplace = page.getByLabel("Marketplace", { exact: true });
  await marketplace.selectOption("Amazon.com");
  await columnTrigger(page, "Inventory health status").click();
  const menu = page.getByRole("dialog", { name: "Inventory health status options", exact: true });
  await menu.getByRole("checkbox", { name: "Low stock", exact: true }).check();
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  const filters = page.getByRole("group", { name: "Applied inventory filters", exact: true });
  expect((await marketplace.boundingBox()).width).toBeGreaterThan(200);
  await filters
    .getByRole("button", { name: "Remove Health: Low stock", exact: true })
    .press("Enter");
  await expect(page.getByLabel("Search", { exact: true })).toBeFocused();
  await expect(filters.getByRole("button", { name: "Remove Health: Low stock" })).toHaveCount(0);
  await expect(marketplace).toHaveValue("Amazon.com");
  await expect(page.getByRole("button", { name: "Show transactions for QA-002" })).toBeVisible();
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
  await page.screenshot({ path: testInfo.outputPath("phone-inventory-filters.png") });
});
