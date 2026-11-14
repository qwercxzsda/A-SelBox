import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

test("Back and Forward restore focus to the active workspace tab", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  await mockInventory(page, [inventoryRow("QA-001")]);
  await signIn(page);
  const inventory = page.getByRole("tab", { name: "Inventory", exact: true });
  const companies = page.getByRole("tab", { name: "Companies", exact: true });
  await inventory.click();
  await companies.click();
  await page.goBack();
  await expect(inventory).toHaveAttribute("aria-selected", "true");
  await expect(inventory).toBeFocused();
  await page.goForward();
  await expect(companies).toBeFocused();
  const search = page.getByLabel("Search companies", { exact: true });
  await search.fill("Company");
  await expect(search).toBeFocused();
});

test("history within the same tab restores a keyboard entry point after paging", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.totalCount = 80;
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rowWithSku(page, "ALPHA-051")).toBeVisible();
  await page.goBack();
  await expect(rowWithSku(page, "ALPHA-026")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeFocused();
});

test("a restored row dialog keeps its own autofocus ahead of the workspace tab", async ({
  page,
}) => {
  await mockSupabase(page);
  await signIn(page);
  await rowWithSku(page, "ALPHA-001").click();
  const drawer = page.getByRole("dialog", { name: "Transaction details", exact: true });
  await drawer.getByRole("button", { name: "Close row details", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.goBack();
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Close row details", exact: true }),
  ).toBeFocused();
  await page.goForward();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeFocused();
});
