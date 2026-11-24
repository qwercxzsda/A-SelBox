import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";

import { REVIEW_COMPANY, setupFinancialReview } from "./allocation-fixtures.mjs";
import { item, openEditor, openReview, editor } from "./sku-configuration-fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";
import { preventedBrowserGestures, UNPREVENTED_BROWSER_GESTURES } from "./browser-gestures.mjs";
import { columnTrigger } from "./table-actions.mjs";

const drawer = (page, name) => page.getByRole("dialog", { name, exact: true });
const financialTable = (page) =>
  page.getByRole("table", { name: "Financial records", exact: true });

async function setup(page) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.skuConfigurationItems = [item("S1", { company_id: REVIEW_COMPANY })];
  fixture.aggregateRows = [summaryBucket("2026-09-01", "10"), summaryBucket("2026-09-02", "0")];
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "10")];
  await mockInventory(page, [inventoryRow("GESTURE-SKU", { company_id: REVIEW_COMPANY })]);
  await signIn(page);
  return fixture;
}

async function checkPanelGestures(page, panel) {
  await expect(panel).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
  for (const target of [
    panel.locator(".mantine-Drawer-header"),
    panel.locator(".ui-drawer-body"),
  ]) {
    expect(await preventedBrowserGestures(target)).toEqual(UNPREVENTED_BROWSER_GESTURES);
  }
  await expect(panel).toHaveCSS("overscroll-behavior-x", "auto");
  await expect(panel).toHaveCSS("overscroll-behavior-y", "contain");
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
}

async function closePanel(page, panel) {
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator("html")).not.toHaveCSS("overflow-y", "hidden");
}

test("every drawer preserves zoom/navigation gestures, including nested source details", async ({
  page,
}) => {
  await setup(page);
  await financialTable(page).locator("tbody tr").first().click();
  const details = drawer(page, "Transaction details");
  await checkPanelGestures(page, details);
  await closePanel(page, details);

  await page
    .getByRole("button", { name: "View Last day for Amazon.com in USD by type", exact: false })
    .click();
  const breakdown = drawer(page, "Transaction totals");
  await checkPanelGestures(page, breakdown);
  await closePanel(page, breakdown);

  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await page
    .getByRole("table", { name: "User accounts", exact: true })
    .locator("tbody tr")
    .first()
    .click();
  const membership = drawer(page, "Company membership");
  await checkPanelGestures(page, membership);
  await closePanel(page, membership);

  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await openEditor(page);
  await checkPanelGestures(page, editor(page));
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await openReview(page);
  const review = drawer(page, "Review configuration changes");
  await checkPanelGestures(page, review);
  await closePanel(page, review);

  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await page.locator(".inventory-table tbody tr").first().click();
  const inventory = drawer(page, "Inventory details");
  await checkPanelGestures(page, inventory);
  await closePanel(page, inventory);

  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await financialTable(page).locator("tbody tr.inspectable-row").first().click();
  const payout = drawer(page, "Payout report details");
  await checkPanelGestures(page, payout);
  await closePanel(page, payout);
});

test("column popups contain vertical scrolling without suppressing horizontal navigation", async ({
  page,
}) => {
  await setup(page);
  for (const [column, selector] of [
    ["Type", ".type-filter-groups"],
    ["SKU", ".column-menu-options"],
  ]) {
    await columnTrigger(page, column).click();
    const menu = drawer(page, `${column} options`);
    const options = menu.locator(selector);
    await expect(menu).toHaveCSS("overscroll-behavior-x", "auto");
    await expect(menu).toHaveCSS("overscroll-behavior-y", "contain");
    for (const target of [menu, options])
      expect(await preventedBrowserGestures(target)).toEqual(UNPREVENTED_BROWSER_GESTURES);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
});
