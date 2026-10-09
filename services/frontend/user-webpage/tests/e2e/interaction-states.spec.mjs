import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { kioskRow, settlementRow, skuAssignments } from "./api-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { item } from "./sku-configuration-fixtures.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
const panel = (page, name) => page.getByRole("dialog", { name, exact: true });
const firstRecord = (page) =>
  page
    .getByRole("table", { name: "Financial records", exact: true })
    .locator("tbody tr.inspectable-row")
    .first();

async function appearance(locator) {
  return locator.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
}

async function waitForAnimations(locator) {
  await locator.evaluate(async (element) => {
    await new Promise(globalThis.requestAnimationFrame);
    const animations = new Set();
    for (let parent = element; parent; parent = parent.parentElement) {
      for (const animation of parent.getAnimations()) animations.add(animation);
    }
    await Promise.all([...animations].map((animation) => animation.finished));
  });
}

async function prepareHover(page, locator) {
  // Let opened accordions finish and Playwright bring the control into view first.
  await locator.hover();
  await page.mouse.move(0, 0);
  await expect.poll(() => locator.evaluate((element) => element.matches(":hover"))).toBe(false);
  await waitForAnimations(locator);
  await locator.scrollIntoViewIfNeeded();
}

async function expectStableBounds(locator, before) {
  const after = await locator.boundingBox();
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.height).toBeCloseTo(before.height, 1);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
}

async function hoverChangesShade(page, locator) {
  await prepareHover(page, locator);
  const before = await appearance(locator);
  const bounds = await locator.boundingBox();
  await locator.hover();
  await expect.poll(() => appearance(locator)).not.toEqual(before);
  await expectStableBounds(locator, bounds);
}

async function hoverEmphasizesText(page, locator) {
  await prepareHover(page, locator);
  const before = await appearance(locator);
  const bounds = await locator.boundingBox();
  await expect(locator).toHaveCSS("text-decoration-line", "underline");
  await expect(locator).not.toHaveCSS("text-decoration-thickness", "2px");
  await locator.hover();
  await expect(locator).toHaveCSS("text-decoration-thickness", "2px");
  await waitForAnimations(locator);
  await expect.poll(() => appearance(locator)).toEqual(before);
  await expectStableBounds(locator, bounds);
}

async function expectKeyboardFocus(page, locator) {
  await page.keyboard.press("Tab");
  await locator.focus();
  await expect(locator).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.style).not.toBe("none");
}

async function setup(page, administrator = true) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  if (!administrator) fixture.roles["member-a"] = "member";
  fixture.skuConfigurationItems = [item("S1", { company_id: REVIEW_COMPANY })];
  fixture.assignments = skuAssignments(["S1"], REVIEW_COMPANY);
  fixture.settlementRows = [settlementRow(1)];
  fixture.kioskRows = [kioskRow(1, "10")];
  fixture.aggregateRows = [summaryBucket("2026-09-01", "10")];
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "10")];
  await mockInventory(page, [inventoryRow("S1", { company_id: REVIEW_COMPANY })]);
  await signIn(page);
  return fixture;
}

test("sign-in and sign-up actions visibly respond without moving and retain keyboard focus", async ({
  page,
}) => {
  await mockSupabase(page);
  await hoverChangesShade(page, button(page, "Sign in"));
  await expectKeyboardFocus(page, button(page, "Sign in"));
  const switchMode = button(page, "New to A-SelBox? Create an account");
  await hoverChangesShade(page, switchMode);
  await switchMode.click();
  await hoverChangesShade(page, button(page, "Create account"));
  await hoverChangesShade(page, button(page, "Already have an account? Sign in"));
});

test("summary cards and date links keep distinct keyboard and click actions without the visible hint", async ({
  page,
}) => {
  await setup(page, false);
  const card = page.getByRole("article", { name: "Latest day estimated totals", exact: true });
  const open = button(card, "View Latest day by type");
  const date = card.getByRole("button", { name: /^Filter transactions to / });
  await expect(card.getByText("View by type", { exact: false })).toHaveCount(0);
  await hoverChangesShade(page, open);
  await expect
    .poll(async () => {
      const { background } = await appearance(open);
      return Number(background.match(/[,/]\s*([.\d]+)\s*\)$/)?.[1]);
    })
    .toBeCloseTo(0.03, 4);
  await expectKeyboardFocus(page, open);
  await hoverEmphasizesText(page, date);
  await expectKeyboardFocus(page, date);
  await date.press("Enter");
  await expect(panel(page, "Amounts by type")).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Selected dates estimated totals", exact: true }),
  ).toContainText("10 USD");
  await open.focus();
  await open.press("Enter");
  const breakdown = panel(page, "Amounts by type");
  await expect(breakdown).toBeVisible();
  await hoverChangesShade(page, button(breakdown, "Sales and refunds details"));
  await hoverChangesShade(page, button(breakdown, "Close breakdown"));
  await button(breakdown, "Close breakdown").click();
  await expect(open).toBeFocused();
});

test("workspace controls share hover feedback across every administrator tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  const transactions = page.getByRole("tab", { name: "Transactions", exact: true });
  await hoverChangesShade(page, transactions);
  await expectKeyboardFocus(page, transactions);
  await hoverChangesShade(page, button(page, "Date"));
  await button(page, "Date").click();
  const options = panel(page, "Date options");
  await hoverChangesShade(page, button(options, "Close options"));
  await button(options, "Close options").click();

  for (const name of [
    "Transactions",
    "Settlements",
    "Data Kiosk",
    "Payout reports",
    "User access",
  ]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await hoverChangesShade(page, tab);
    await tab.click();
    const row = firstRecord(page);
    await hoverChangesShade(page, row);
    await expectKeyboardFocus(page, row);
    await row.press("Enter");
    const details = panel(
      page,
      name === "User access" ? "Company membership" : "Selected row details",
    );
    await expect(details).toBeVisible();
    await expect(row).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
  }

  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await hoverEmphasizesText(page, button(page, "Open review for June 2026"));
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  const details = button(page, "Show details for Review Company");
  await hoverChangesShade(page, details);
  await details.click();
  await hoverChangesShade(page, button(page, "View members"));
  const create = button(page, "Create company");
  await expect(create).toBeDisabled();
  const disabled = await appearance(create);
  await create.hover();
  await expect.poll(() => appearance(create)).toEqual(disabled);
  await page.getByLabel("Company name", { exact: true }).fill("Hover review");
  await expect(create).toBeEnabled();
  await hoverChangesShade(page, create);
  await expectKeyboardFocus(page, create);
});

test("SKU text actions share the date-link appearance in fees, inventory and companies", async ({
  page,
}) => {
  await setup(page);
  const date = page.locator(".estimated-summary-period").first();
  const dateColor = (await appearance(date)).color;
  for (const name of ["Current fees", "Inventory", "Companies"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    if (name === "Companies") await button(page, "Show details for Review Company").click();
    const sku = button(page, "Show transactions for S1");
    await expect(sku).toHaveCSS("color", dateColor);
    await hoverEmphasizesText(page, sku);
    await expectKeyboardFocus(page, sku);
    if (name === "Current fees")
      await hoverChangesShade(page, button(page, "Show marketplace fees for S1"));
    if (name === "Inventory")
      await hoverChangesShade(page, page.locator(".inventory-table tbody tr").first());
  }
});

test("filter fields, checkbox labels and company choices have matching pointer feedback", async ({
  page,
}) => {
  await setup(page);
  const accent = (await appearance(page.locator(".estimated-summary-period").first())).color;
  await button(page, "Date").click();
  const dateOptions = panel(page, "Date options");
  const fromDate = dateOptions.getByLabel("From date", { exact: true });
  await hoverChangesShade(page, fromDate);
  await fromDate.focus();
  await expect(fromDate).toHaveCSS("border-color", accent);
  await button(dateOptions, "Close options").click();
  await button(page, "SKU").click();
  const skuOptions = panel(page, "SKU options");
  await hoverChangesShade(page, skuOptions.locator(".ui-checkbox").first());
  await button(skuOptions, "Close options").click();
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByText("member-b@example.test", { exact: true }) })
    .click();
  const membership = panel(page, "Company membership");
  const company = membership.getByRole("combobox", { name: "Company", exact: true });
  await hoverChangesShade(page, company);
  await company.fill("Review");
  const option = page.getByRole("option", { name: "Review Company", exact: true });
  await company.press("ArrowDown");
  await expect(option).toHaveAttribute("data-combobox-selected");
  await expect(option).toHaveCSS("color", (await appearance(company)).color);
  await hoverChangesShade(page, option);
  await option.click();
  await expect(company).toHaveValue("Review Company");
  await expect(button(membership, "Save membership")).toBeEnabled();
});

test.describe("mouse input on a touch-configured browser", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 1440, height: 1000 } });

  test("sign-in buttons and the password icon respond even when hover capability is reported as none", async ({
    page,
  }) => {
    await mockSupabase(page);
    expect(await page.evaluate(() => globalThis.matchMedia("(hover: hover)").matches)).toBe(false);
    expect(await page.evaluate(() => globalThis.matchMedia("(any-hover: hover)").matches)).toBe(
      false,
    );
    // A real mouse event can still arrive on a touch-configured browser. Do not gate
    // its :hover feedback on the capability reported by a media query.
    await hoverChangesShade(page, button(page, "Sign in"));
    await hoverChangesShade(page, button(page, "New to A-SelBox? Create an account"));
    await hoverChangesShade(page, button(page, "Toggle password visibility"));
  });

  test("cards, links, tabs, menus, rows and company controls retain pointer feedback", async ({
    page,
  }) => {
    await setup(page);
    expect(await page.evaluate(() => globalThis.matchMedia("(hover: hover)").matches)).toBe(false);
    await hoverChangesShade(page, button(page, "Sign out"));
    await hoverChangesShade(page, button(page, "View Latest day by type"));
    await hoverEmphasizesText(page, page.locator(".estimated-summary-period").first());
    await hoverChangesShade(page, page.getByRole("tab", { name: "Transactions", exact: true }));
    await hoverChangesShade(page, firstRecord(page));
    await hoverChangesShade(page, button(page, "Date"));
    await button(page, "Date").click();
    const options = panel(page, "Date options");
    await hoverChangesShade(page, button(options, "Close options"));
    await hoverChangesShade(page, button(options, "Clear dates"));
    await hoverChangesShade(page, button(options, "Apply dates"));
    await button(options, "Close options").click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await hoverChangesShade(page, button(page, "Add company"));
    await page.getByRole("tab", { name: "Companies", exact: true }).click();
    await hoverChangesShade(page, button(page, "Show details for Review Company"));
    const create = button(page, "Create company");
    await expect(create).toBeDisabled();
    const disabled = await appearance(create);
    await create.hover();
    await expect.poll(() => appearance(create)).toEqual(disabled);
    await page.getByLabel("Company name", { exact: true }).fill("Pointer review");
    await expect(create).toBeEnabled();
    await hoverChangesShade(page, create);
  });
});

test.describe("touch interaction", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  test("summary and SKU actions work without hover while manual zoom remains available", async ({
    page,
  }) => {
    await setup(page, false);
    expect(await page.evaluate(() => globalThis.matchMedia("(hover: hover)").matches)).toBe(false);
    const open = button(page, "View Latest day by type");
    // signIn uses a mouse click; move that pointer off the newly mounted card
    // before comparing its idle appearance with the result of touch-only actions.
    await page.mouse.move(0, 0);
    await expect.poll(() => open.evaluate((element) => element.matches(":hover"))).toBe(false);
    await open.evaluate(async (element) => {
      await new Promise(globalThis.requestAnimationFrame);
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const idleCard = await appearance(open);
    await open.tap();
    await expect(panel(page, "Amounts by type")).toBeVisible();
    await button(page, "Close breakdown").tap();
    await expect.poll(() => appearance(open)).toEqual(idleCard);
    await page.getByRole("tab", { name: "Inventory", exact: true }).tap();
    await button(page, "Show transactions for S1").tap();
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/);
  });
});
