import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { applyDates, applyReportMonth, selectColumnOptions, sortBy } from "./table-actions.mjs";

for (const clearAll of [false, true]) {
  test(`clearing ${clearAll ? "all financial filters" : "the last financial filter"} returns keyboard focus without changing search or ordering`, async ({
    page,
  }) => {
    await mockSupabase(page);
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    const search = page.getByLabel("Search", { exact: true });
    await search.fill("Amazon");
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await sortBy(page, "Date", "Oldest first");
    await selectColumnOptions(page, "Marketplace", ["Amazon.com"]);
    if (clearAll) await applyDates(page, "2026-01-01");
    const filters = page.getByRole("group", { name: "Applied table filters", exact: true });
    await filters
      .getByRole("button", {
        name: clearAll ? "Clear filters" : "Clear marketplace filter: Amazon.com",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Enter");
    await expect(filters).toHaveCount(0);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("Amazon");
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await expect(page.getByRole("columnheader", { name: "Date", exact: true })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
}

test("removing an inventory health chip restores keyboard focus and keeps other refinements", async ({
  page,
}) => {
  await mockSupabase(page);
  await mockInventory(page, [
    inventoryRow("QA-001", { health_status: "Low stock" }),
    inventoryRow("QA-002", { health_status: "Healthy" }),
  ]);
  await signIn(page);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("QA");
  await page.getByLabel("Rows", { exact: true }).selectOption("50");
  await sortBy(page, "SKU", "Z to A");
  await selectColumnOptions(page, "Inventory health status", ["Low stock"]);
  const filters = page.getByRole("group", { name: "Applied inventory filters", exact: true });
  await filters.getByRole("button", { name: "Remove Health: Low stock", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("QA");
  await expect(
    filters.getByRole("button", { name: "Remove Search: QA", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
  await expect(page.getByRole("columnheader", { name: "SKU", exact: true })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(
    page.getByRole("button", { name: "Show transactions for QA-002", exact: true }),
  ).toBeVisible();
  await filters.getByRole("button", { name: "Remove Search: QA", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(filters).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
});

test("clearing the last payout month chip returns keyboard focus to its search", async ({
  page,
}) => {
  await mockSupabase(page);
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  const search = page.getByLabel("Search", { exact: true });
  await search.fill("USD");
  await sortBy(page, "Month", "Oldest first");
  await applyReportMonth(page, "2026-06");
  const filters = page.getByRole("group", { name: "Applied table filters", exact: true });
  await filters
    .getByRole("button", { name: "Clear report month filter: 2026-06", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(filters).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("USD");
  await expect(page.getByRole("columnheader", { name: "Month", exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
});

test("pointer removal of a financial chip does not focus the search field", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);
  await selectColumnOptions(page, "Marketplace", ["Amazon.com"]);
  await page
    .getByRole("button", { name: "Clear marketplace filter: Amazon.com", exact: true })
    .click();
  await expect(page.getByLabel("Search", { exact: true })).not.toBeFocused();
});
