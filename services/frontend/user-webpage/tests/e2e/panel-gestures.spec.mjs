import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { item, openEditor, openReview, editor } from "./sku-configuration-fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";
import { preventedBrowserGestures, UNPREVENTED_BROWSER_GESTURES } from "./browser-gestures.mjs";

const drawer = (page, name) => page.getByRole("dialog", { name, exact: true });
const financialTable = (page) =>
  page.getByRole("table", { name: "Financial records", exact: true });

async function setup(page) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.skuConfigurationItems = [item("S1", { company_id: REVIEW_COMPANY })];
  fixture.aggregateRows = [summaryBucket("2026-09-01", "10")];
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
  const details = drawer(page, "Selected row details");
  await checkPanelGestures(page, details);
  await closePanel(page, details);

  await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
  const breakdown = drawer(page, "Amounts by type");
  await checkPanelGestures(page, breakdown);
  await closePanel(page, breakdown);

  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await financialTable(page).locator("tbody tr").first().click();
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
  await checkPanelGestures(page, details);
  await closePanel(page, details);

  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByRole("button", { name: "Open review for June 2026", exact: true }).click();
  const monthly = drawer(page, "Monthly financial review");
  await checkPanelGestures(page, monthly);
  await monthly.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await monthly
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr.inspectable-row")
    .first()
    .click();
  const sources = drawer(page, "Saved source details");
  await checkPanelGestures(page, sources);
  await page.keyboard.press("Escape");
  await expect(sources).toBeHidden();
  await expect(monthly).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
  await closePanel(page, monthly);
});

test("native wheel scrolls a long panel while its background stays fixed and returns focus", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName === "webkit" && isMobile,
    "Playwright cannot send wheel events to mobile WebKit.",
  );
  await setup(page);
  await page.evaluate(() => globalThis.scrollTo(0, 200));
  const trigger = financialTable(page).locator("tbody tr").first();
  await trigger.click();
  const panel = drawer(page, "Selected row details");
  await checkPanelGestures(page, panel);
  const position = await page.evaluate(() => globalThis.scrollY);
  await page.mouse.move(30, 200);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => globalThis.scrollY)).toBe(position);
  await closePanel(page, panel);
  await expect(trigger).toBeFocused();

  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByRole("button", { name: "Open review for June 2026", exact: true }).click();
  const monthly = drawer(page, "Monthly financial review");
  await monthly.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await monthly
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr.inspectable-row")
    .first()
    .click();
  const sources = drawer(page, "Saved source details");
  await expect(
    sources.getByRole("table", { name: "Supporting payout records", exact: true }),
  ).toBeVisible();
  // Hover waits for the drawer's opening transition before placing the wheel target.
  await sources.hover({ position: { x: 150, y: 300 } });
  await page.mouse.wheel(0, 600);
  await expect.poll(() => sources.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await checkPanelGestures(page, sources);
});

test("column popups contain vertical scrolling without suppressing horizontal navigation", async ({
  page,
}) => {
  await setup(page);
  for (const [column, selector] of [
    ["Type", ".type-filter-groups"],
    ["SKU", ".column-menu-options"],
  ]) {
    await page.getByRole("button", { name: column, exact: true }).click();
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
