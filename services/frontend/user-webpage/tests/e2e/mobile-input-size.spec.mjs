import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { COMPANY, editor, item, openEditor } from "./sku-configuration-fixtures.mjs";
import { openColumn } from "./table-actions.mjs";

async function checkControl(control, mobile) {
  await expect(control).toBeVisible();
  if (mobile) {
    // iOS focus zoom is a browser-chrome behavior; assert its preventive font-size condition.
    await expect
      .poll(() =>
        control.evaluate((element) =>
          Number.parseFloat(globalThis.getComputedStyle(element).fontSize),
        ),
      )
      .toBeGreaterThanOrEqual(16);
  } else {
    await expect(control).toHaveCSS("font-size", "13px");
  }
}

async function checkPageWidth(page) {
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
}

async function checkWorkspaceControls(page, mobile) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyNames[COMPANY] = "Alpha Company";
  fixture.skuConfigurationItems = [item("S1")];

  await checkControl(page.getByLabel(/^Email/), mobile);
  await checkControl(page.getByLabel(/^Password/), mobile);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i);
  await signIn(page);

  await checkControl(page.getByRole("searchbox", { name: "Search", exact: true }), mobile);
  const rows = page.getByRole("combobox", { name: "Rows", exact: true });
  await checkControl(rows, mobile);
  await rows.selectOption("50");
  await expect(rows).toHaveValue("50");
  await checkControl(page.getByRole("textbox", { name: "Page number", exact: true }), mobile);
  await expect(
    page.getByRole("table", { name: "Financial records", exact: true }).locator("tbody td").first(),
  ).toHaveCSS("font-size", "13px");

  const typeMenu = await openColumn(page, "Type");
  const filterSearch = typeMenu.getByLabel("Search type", { exact: true });
  await checkControl(filterSearch, mobile);
  await filterSearch.fill("storage");
  await expect(typeMenu.getByRole("checkbox").first()).toBeVisible();
  await checkPageWidth(page);
  await typeMenu.getByRole("button", { name: "Done", exact: true }).click();
  const dateMenu = await openColumn(page, "Date");
  await checkControl(dateMenu.getByLabel("From date", { exact: true }), mobile);
  await checkControl(dateMenu.getByLabel("To date", { exact: true }), mobile);
  await dateMenu.getByRole("button", { name: "Close options", exact: true }).click();

  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ has: page.getByText("member-b@example.test", { exact: true }) })
    .click();
  const membership = page.getByRole("dialog", { name: "Company membership", exact: true });
  const company = membership.getByRole("combobox", { name: "Company", exact: true });
  await checkControl(company, mobile);
  await company.fill("Alpha");
  const option = page.getByRole("option", { name: "Alpha Company", exact: true });
  await expect(option).toBeInViewport();
  await option.click();
  await expect(company).toHaveValue("Alpha Company");
  await expect(
    membership.getByRole("button", { name: "Save membership", exact: true }),
  ).toBeEnabled();
  await checkPageWidth(page);
  await membership.getByRole("button", { name: "Close membership details", exact: true }).click();

  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await openEditor(page);
  for (const label of [
    "Company",
    "Marketplace 1",
    "Fee rate 1 (%)",
    "Start date 1 (inclusive)",
    "End date 1 (exclusive)",
  ]) {
    const control = editor(page).getByLabel(label, { exact: true });
    await control.scrollIntoViewIfNeeded();
    await checkControl(control, mobile);
  }
  await editor(page).getByLabel("Marketplace 1", { exact: true }).selectOption("Amazon.com");
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.25");
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.25");
  await checkPageWidth(page);
  expect(fixture.membershipRequests).toHaveLength(0);
  expect(fixture.configurationSaves).toHaveLength(0);
}

test.describe("iPhone-sized touch controls", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const [orientation, viewport] of [
    ["portrait", { width: 390, height: 844 }],
    ["landscape", { width: 844, height: 390 }],
  ]) {
    test(`${orientation} editable controls stay at least 16px without enlarging table data`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await checkWorkspaceControls(page, true);
    });
  }
});

test("desktop controls and financial table text retain the existing 13px density", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkWorkspaceControls(page, false);
});
