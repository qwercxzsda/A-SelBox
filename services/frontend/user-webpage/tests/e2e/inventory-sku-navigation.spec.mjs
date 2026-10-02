import { expect, test } from "@playwright/test";
import { liveRow } from "./api-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { COMPANY, item, setup } from "./sku-configuration-fixtures.mjs";
import { applyDates, openColumn, sortBy } from "./table-actions.mjs";

const SKU = 'SKU (A), "blue" / 50%';

for (const role of ["operator", "company_member"]) {
  test(`${role} opens exact-SKU transactions from inventory and retains both tab states`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: role === "operator" ? 1440 : 390, height: 1000 });
    const fixture = await setup(page, role, [item("S1"), item(SKU)], (fixture) => {
      fixture.liveRows = Array.from({ length: 60 }, (_, index) => ({
        ...liveRow("INVENTORY-NAVIGATION", index + 1, COMPANY),
        sku: index < 30 ? SKU : `${SKU}-EXTRA`,
      }));
    });
    await mockInventory(page, [
      inventoryRow(SKU, { marketplace_name: "Amazon.ca" }),
      inventoryRow("S1"),
    ]);

    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await sortBy(page, "Date", "Oldest first");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
    await applyDates(page, "2026-01-01", "2026-01-31");
    await page.getByLabel("Search", { exact: true }).fill("unrelated search");
    const oldSkuMenu = await openColumn(page, "SKU");
    await oldSkuMenu.getByRole("checkbox", { name: "S1", exact: true }).check();
    await oldSkuMenu.getByRole("button", { name: "Close options", exact: true }).click();
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.ca");
    await page.getByLabel("Search", { exact: true }).fill("blue");
    await sortBy(page, "Sales · last 90 days", "Highest first");
    const region = page.getByRole("region", { name: "Inventory items" });
    await expect(region.locator(".inventory-sku")).toHaveText([SKU]);
    await region.getByText("Amazon.ca", { exact: true }).click();
    const details = page.getByRole("dialog", { name: "Inventory details", exact: true });
    await expect(details).toBeVisible();
    await details.getByRole("button", { name: "Close inventory details", exact: true }).click();
    const sku = region.getByRole("button", {
      name: `Show transactions for ${SKU}`,
      exact: true,
    });
    if (role === "operator") await sku.click();
    else {
      await sku.focus();
      await page.keyboard.press("Enter");
    }

    await expect(details).toHaveCount(0);
    const transactions = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(transactions.getByRole("cell", { name: SKU, exact: true })).toHaveCount(30);
    await expect(transactions.getByRole("cell", { name: `${SKU}-EXTRA`, exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await expect(page.getByText("1 filter applied", { exact: true })).toBeVisible();
    expect(fixture.requests.at(-1).args).toMatchObject({
      p_skus: [SKU],
      p_company_ids: [],
      p_marketplaces: [],
      p_sources: [],
      p_types: [],
      p_date_from: null,
      p_date_to: null,
      p_fee_applicable: null,
      p_search_skus: null,
      p_direction: "asc",
      p_limit: 50,
      p_offset: 0,
    });

    await page.reload();
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(transactions.getByRole("cell", { name: SKU, exact: true })).toHaveCount(30);
    expect(fixture.requests.at(-1).args.p_skus).toEqual([SKU]);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(sku).toBeVisible();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("blue");
    await expect(page.getByLabel("Marketplace", { exact: true })).toHaveValue("Amazon.ca");
    await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
    await expect(region.getByRole("columnheader").nth(1)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(details).toHaveCount(0);
    await expect(region.getByText("Inbound received", { exact: true })).toHaveCount(0);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize().width);
  });
}
