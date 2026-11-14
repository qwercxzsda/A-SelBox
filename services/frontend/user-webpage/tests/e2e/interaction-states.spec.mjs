import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { kioskRow, financesRow, skuAssignments } from "./api-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { REVIEW_COMPANY, setupFinancialReview } from "./financial-review-fixtures.mjs";
import { item, feeRow, feeDetails } from "./sku-configuration-fixtures.mjs";
import { companyRow, companyPanel, closeCompanyDetails } from "./company-actions.mjs";
import { summaryBucket, typeBucket } from "./summary-fixtures.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
const panel = (page, name) => page.getByRole("dialog", { name, exact: true });
const currentTotals = (page) => page.getByRole("region", { name: "Current totals", exact: true });
const dayTotals = (page) =>
  currentTotals(page).getByRole("table", { name: "Last day marketplace totals", exact: true });
const summaryRow = (page) =>
  dayTotals(page).getByRole("row", { name: "Amazon.com USD totals", exact: true });
const summaryDetails = (page) => summaryRow(page).getByRole("button", { name: /by type: / });
const firstRecord = (page, tableName = "Financial records") =>
  page
    .getByRole("table", { name: tableName, exact: true })
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
  // Let opened panels finish and Playwright bring the control into view first.
  await locator.hover();
  await page.mouse.move(0, 0);
  await expect.poll(() => locator.evaluate((element) => element.matches(":hover"))).toBe(false);
  await locator.scrollIntoViewIfNeeded();
  await waitForAnimations(locator);
}

// Hover may legitimately scroll a window or nested panel. Measure visual geometry
// in its scroll content so translation/size changes still fail, but scrolling does not.
async function layoutBounds(locator) {
  return locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    let scrollX = 0;
    let scrollY = 0;
    let fixed = false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor !== element && ancestor !== globalThis.document.scrollingElement) {
        scrollX += ancestor.scrollLeft;
        scrollY += ancestor.scrollTop;
      }
      if (globalThis.getComputedStyle(ancestor).position === "fixed") {
        fixed = true;
        break;
      }
    }
    if (!fixed) {
      scrollX += globalThis.scrollX;
      scrollY += globalThis.scrollY;
    }
    return { x: x + scrollX, y: y + scrollY, width, height };
  });
}

async function expectStableBounds(locator, before) {
  const after = await layoutBounds(locator);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.height).toBeCloseTo(before.height, 1);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
}

async function hoverChangesShade(page, locator) {
  await prepareHover(page, locator);
  const before = await appearance(locator);
  const bounds = await layoutBounds(locator);
  await locator.hover();
  await expect.poll(() => appearance(locator)).not.toEqual(before);
  await expectStableBounds(locator, bounds);
}

async function hoverEmphasizesText(page, locator) {
  await prepareHover(page, locator);
  const before = await appearance(locator);
  const bounds = await layoutBounds(locator);
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
  fixture.financesRows = [financesRow(1)];
  fixture.kioskRows = [kioskRow(1, "10")];
  fixture.aggregateRows = [summaryBucket("2026-09-01", "10"), summaryBucket("2026-09-02", "0")];
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "10")];
  await mockInventory(page, [inventoryRow("S1", { company_id: REVIEW_COMPANY })]);
  await signIn(page);
  await currentTotals(page).waitFor();
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

test("summary rows, UTC period shortcuts and the date chooser keep distinct keyboard actions", async ({
  page,
}) => {
  const fixture = await setup(page, false);
  const open = summaryDetails(page);
  const date = button(currentTotals(page), "Choose dates · UTC");
  await expect(date).toHaveAttribute("data-action", "select");
  await expect(date.locator(".totals-calendar-icon")).toHaveCount(1);
  await expect(date.locator(".totals-filter-icon")).toHaveCount(0);
  await expect(date.locator(".totals-date-chevron")).toHaveCount(1);
  await expect(open).toBeVisible();
  await expect(currentTotals(page).getByRole("radiogroup")).toHaveCount(0);
  for (const title of ["Last day", "Last month", "Selected dates"]) {
    await expect(
      currentTotals(page).getByRole("article", { name: `${title} totals`, exact: true }),
    ).toBeVisible();
  }
  await hoverEmphasizesText(page, open);
  await expectKeyboardFocus(page, open);
  await hoverChangesShade(page, date);
  await expectKeyboardFocus(page, date);
  await date.press("Enter");
  await expect(panel(page, "Transaction totals")).toHaveCount(0);
  const dateDialog = panel(page, "Choose summary dates");
  await expect(dateDialog).toBeVisible();
  await dateDialog.getByRole("button", { name: "Close summary dates", exact: true }).click();
  await expect(date).toBeFocused();
  const period = currentTotals(page)
    .getByRole("article", { name: "Last day totals", exact: true })
    .getByRole("button", {
      name: "Filter transactions to Sep 1, 2026 · UTC",
      exact: true,
    });
  await expect(period).toHaveAttribute("data-action", "filter");
  await expect(period.locator(".totals-filter-icon")).toHaveCount(1);
  await expect(period.locator(".totals-calendar-icon")).toHaveCount(0);
  await expect(period.locator(".totals-date-chevron")).toHaveCount(0);
  await hoverChangesShade(page, period);
  await expectKeyboardFocus(page, period);
  await period.press("Enter");
  await expect(panel(page, "Transaction totals")).toHaveCount(0);
  await expect.poll(() => fixture.requests.at(-1)?.args.p_date_from).toBe("2026-09-01");
  expect(fixture.requests.at(-1).args.p_date_to).toBe("2026-09-01");
  await open.focus();
  await open.press("Enter");
  const breakdown = panel(page, "Transaction totals");
  await expect(breakdown).toBeVisible();
  await hoverChangesShade(page, button(breakdown, "Sales & refunds details"));
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
  await hoverChangesShade(page, button(page, "Date (UTC)"));
  await button(page, "Date (UTC)").click();
  const options = panel(page, "Date (UTC) options");
  await hoverChangesShade(page, button(options, "Close options"));
  await button(options, "Close options").click();

  for (const name of ["Transactions", "Finances", "Data Kiosk", "Payout reports", "User access"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await hoverChangesShade(page, tab);
    await tab.click();
    const row = firstRecord(page, name === "User access" ? "User accounts" : "Financial records");
    await hoverChangesShade(page, row);
    if (name === "Transactions")
      await expect
        .poll(
          async () =>
            (await appearance(row.locator('[data-column="company_amount"]'))).background ===
            (await appearance(row)).background,
        )
        .toBe(true);
    await expectKeyboardFocus(page, row);
    await row.press("Enter");
    const details = panel(
      page,
      {
        Transactions: "Transaction details",
        Finances: "Finances record details",
        "Data Kiosk": "Data Kiosk record details",
        "Payout reports": "Payout report details",
        "User access": "Company membership",
      }[name],
    );
    await expect(details).toBeVisible();
    await expect(row).toHaveAttribute("aria-selected", "true");
    if (name === "Transactions")
      await expect
        .poll(
          async () =>
            (await appearance(row.locator('[data-column="company_amount"]'))).background ===
            (await appearance(row)).background,
        )
        .toBe(true);
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
  }

  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await hoverEmphasizesText(page, button(page, "Open review for June 2026"));
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  const details = companyRow(page, "Review Company");
  await hoverChangesShade(page, details);
  await details.click();
  await hoverChangesShade(page, button(companyPanel(page, "Review Company"), "View members"));
  await closeCompanyDetails(page);
  await button(page, "Add company").click();
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

test("SKU text actions share accent styling in fees, inventory and companies", async ({ page }) => {
  await setup(page);
  const amountAction = summaryDetails(page);
  await expect(amountAction).toBeVisible();
  const accentColor = (await appearance(amountAction)).color;
  for (const name of ["Current fees", "Inventory", "Companies"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    if (name === "Companies") await companyRow(page, "Review Company").press("Enter");
    if (name === "Current fees") await feeRow(page, "S1").press("Enter");
    const sku = button(page, "Show transactions for S1");
    await expect(sku).toHaveCSS("color", accentColor);
    await hoverEmphasizesText(page, sku);
    await expectKeyboardFocus(page, sku);
    if (name === "Current fees") {
      await feeDetails(page)
        .getByRole("button", { name: "Close fee details", exact: true })
        .click();
      await hoverChangesShade(page, feeRow(page, "S1"));
    }
    if (name === "Inventory")
      await hoverChangesShade(page, page.locator(".inventory-table tbody tr").first());
    if (name === "Companies") await closeCompanyDetails(page);
  }
});

test("filter fields, checkbox labels and company choices have matching pointer feedback", async ({
  page,
}) => {
  await setup(page);
  const amountAction = summaryDetails(page);
  await expect(amountAction).toBeVisible();
  const accent = (await appearance(amountAction)).color;
  await button(page, "Date (UTC)").click();
  const dateOptions = panel(page, "Date (UTC) options");
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

  test("totals, links, tabs, menus, rows and company controls retain pointer feedback", async ({
    page,
  }) => {
    await setup(page);
    expect(await page.evaluate(() => globalThis.matchMedia("(hover: hover)").matches)).toBe(false);
    await hoverChangesShade(page, button(page, "Sign out"));
    await hoverEmphasizesText(page, summaryDetails(page));
    await hoverChangesShade(page, button(page, "Choose dates · UTC"));
    await hoverChangesShade(page, page.getByRole("tab", { name: "Transactions", exact: true }));
    await hoverChangesShade(page, firstRecord(page));
    await hoverChangesShade(page, button(page, "Date (UTC)"));
    await button(page, "Date (UTC)").click();
    const options = panel(page, "Date (UTC) options");
    await hoverChangesShade(page, button(options, "Close options"));
    await hoverChangesShade(page, button(options, "Clear dates"));
    await hoverChangesShade(page, button(options, "Apply dates"));
    await button(options, "Close options").click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await hoverChangesShade(page, button(page, "Add company"));
    await page.getByRole("tab", { name: "Companies", exact: true }).click();
    await hoverChangesShade(page, companyRow(page, "Review Company"));
    await button(page, "Add company").click();
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
    const open = summaryDetails(page);
    // Reset sign-in's synthetic mouse hover with a neutral touch before testing the action.
    await currentTotals(page).getByRole("heading", { name: "Current totals", exact: true }).tap();
    await expect.poll(() => open.evaluate((element) => element.matches(":hover"))).toBe(false);
    await open.evaluate(async (element) => {
      await new Promise(globalThis.requestAnimationFrame);
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const idleAction = await appearance(open);
    await open.tap();
    await expect(panel(page, "Transaction totals")).toBeVisible();
    await waitForAnimations(panel(page, "Transaction totals"));
    await button(page, "Close breakdown").tap();
    await expect.poll(() => appearance(open)).toEqual(idleAction);
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
