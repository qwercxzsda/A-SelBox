import { expect, test } from "@playwright/test";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { columnTrigger } from "./table-actions.mjs";

for (const [tab, label, placeholder] of [
  ["Transactions", "Search", "SKU, type, source, or marketplace"],
  ["Finances", "Search", "SKU, type, or marketplace"],
  ["Data Kiosk", "Search", "SKU, type, or marketplace"],
  ["Current fees", "Search SKUs", "SKU or company"],
  ["Payout reports", "Search", "Month, marketplace, or currency"],
  ["Inventory", "Search", "SKU, marketplace, health, or recommendation"],
  ["Companies", "Search companies", "Company name or ID"],
  ["User access", "Search", "Email"],
]) {
  test(`clearing ${tab} search returns keyboard focus to its field`, async ({ page }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    if (tab === "Inventory") await mockInventory(page, [inventoryRow("ALPHA-001")]);
    await signIn(page);
    await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const search = page.getByLabel(label, { exact: true });
    await expect(search).toHaveAttribute("placeholder", placeholder);
    expect(
      await search.evaluate((input) => [...input.labels].map((label) => label.textContent)),
    ).toEqual(["Search"]);
    await expect(page.getByText("Search records only", { exact: true })).toHaveCount(0);
    await search.fill("ALPHA");
    await page.getByRole("button", { name: "Clear search", exact: true }).first().focus();
    await page.keyboard.press("Enter");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await page.keyboard.type("Amazon");
    await expect(search).toHaveValue("Amazon");
  });
}

test("clearing a column option search keeps focus inside its input", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);
  await columnTrigger(page, "Marketplace").click();
  const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
  const search = menu.getByRole("textbox", { name: "Search marketplace", exact: true });
  await expect(search).toHaveAttribute("placeholder", "Marketplace");
  expect(
    await search.evaluate((input) => [...input.labels].map((label) => label.textContent)),
  ).toEqual(["Search"]);
  await search.fill("Amazon.co");
  await menu.getByRole("button", { name: "Clear option search", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.keyboard.type("Amazon.de");
  await expect(search).toHaveValue("Amazon.de");
});
