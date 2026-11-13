import { expect, test } from "@playwright/test";
import {
  feeRow,
  feeDetails,
  feeGroup,
  feePeriods,
  toggleFeePeriods,
  OTHER_COMPANY,
  editor,
  item,
  period,
  setup,
  version,
} from "./sku-configuration-fixtures.mjs";
import { openColumn, selectColumnOptions } from "./table-actions.mjs";

const summaryTable = (page) =>
  page.getByRole("table", { name: "Current fee configurations", exact: true });
const summaryRows = (page) => summaryTable(page).locator(".fee-sku-summary");
const row = feeRow;
const japan = {
  marketplace_name: "Amazon.co.jp",
  valid_from: "2026-09-01",
  valid_to: "2026-09-03",
};

test("fee column filters intersect company, required marketplaces and status and persist independently", async ({
  page,
}) => {
  await setup(
    page,
    "administrator",
    [
      item("S1"),
      item("S2", {
        company_id: OTHER_COMPANY,
        periods: [{ ...period(), ...japan }],
        requirements: [japan],
      }),
      item("S3", { periods: [{ ...period(), ...japan }], requirements: [japan] }),
      item("S4", { periods: [], requirements: [japan] }),
    ].map((row, index) => ({
      ...row,
      sku_id: version(index + 1),
      terms_version_id: version(index + 11),
    })),
  );
  await expect(page.getByRole("checkbox", { name: "Needs setup only", exact: true })).toHaveCount(
    0,
  );
  await selectColumnOptions(page, "Company", ["Alpha Company"]);
  await selectColumnOptions(page, "Marketplace", ["Amazon.co.jp"]);
  await selectColumnOptions(page, "Status", ["Needs setup"]);
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S4")).toBeVisible();
  await expect(row(page, "S4")).toContainText("No fee periods");
  await expect(row(page, "S4").locator('[data-column="marketplace"]')).toHaveText("Amazon.co.jp");
  await page.reload();
  await expect(row(page, "S4")).toBeVisible();
  await expect(summaryRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Status: Needs setup", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
  await selectColumnOptions(page, "Status", ["Saved"]);
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S3")).toBeVisible();
  await page.getByRole("button", { name: "Remove Company: Alpha Company", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
  await selectColumnOptions(page, "Status", ["Needs setup"]);
  await expect(summaryRows(page)).toHaveCount(3);
  const menu = await openColumn(page, "Status");
  await expect(menu.getByRole("checkbox", { name: "Saved", exact: true })).toBeChecked();
  await expect(menu.getByRole("checkbox", { name: "Needs setup", exact: true })).toBeChecked();
});

test("SKU selection uses exact values, intersects other filters, and restores across reload", async ({
  page,
}, testInfo) => {
  const fixture = await setup(
    page,
    "administrator",
    [
      item("S1"),
      item(" Literal [A] "),
      item("literal [a]", { company_id: OTHER_COMPANY }),
      ...Array.from({ length: 28 }, (_, index) => item(`Z-${String(index + 1).padStart(2, "0")}`)),
    ].map((configuration, index) => ({
      ...configuration,
      sku_id: version(index + 1),
      terms_version_id: version(index + 101),
    })),
  );
  await toggleFeePeriods(page, "S1");
  await page
    .getByRole("navigation", { name: "Pagination", exact: true })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Page number", exact: true })).toHaveValue("2");
  let menu = await openColumn(page, "SKU");
  await menu.getByRole("textbox", { name: "Search sku", exact: true }).fill("[a]");
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await menu.getByRole("checkbox", { name: "Literal [A]", exact: true }).check();
  await menu.getByRole("checkbox", { name: "literal [a]", exact: true }).check();
  await page.screenshot({
    path: testInfo.outputPath("sku-filter-options.png"),
    animations: "disabled",
  });
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page number", exact: true })).toHaveValue("1");
  await expect(summaryRows(page)).toHaveCount(2);
  expect(
    await summaryTable(page)
      .locator("tbody.fee-sku-group")
      .evaluateAll((groups) => groups.map((group) => group.dataset.sku)),
  ).toEqual([" Literal [A] ", "literal [a]"]);
  await selectColumnOptions(page, "Company", ["Alpha Company"]);
  await expect(summaryRows(page)).toHaveCount(1);
  menu = await openColumn(page, "SKU");
  await expect(menu.getByRole("checkbox")).toHaveCount(31);
  await expect(menu.getByRole("checkbox", { name: "literal [a]", exact: true })).toBeChecked();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await page.reload();
  await expect(summaryRows(page)).toHaveCount(1);
  expect(await summaryTable(page).locator("tbody.fee-sku-group").getAttribute("data-sku")).toBe(
    " Literal [A] ",
  );
  await page.getByRole("button", { name: "Remove Company: Alpha Company", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
  await page.getByLabel("Search SKUs", { exact: true }).fill("absent");
  await expect(page.getByText("No SKUs match these filters.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(25);
  await expect(page.getByRole("button", { name: /^Remove SKU:/ })).toHaveCount(0);
  await expect(feePeriods(page, "S1")).toHaveCount(1);
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("25");
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("the SKU menu includes staged new SKUs and removing its chip keeps the draft", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByRole("combobox", { name: "SKU", exact: true }).fill(" DRAFT.NEW ");
  await editor(page)
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption(OTHER_COMPANY);
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await selectColumnOptions(page, "SKU", ["DRAFT.NEW"]);
  await expect(summaryRows(page)).toHaveCount(1);
  expect(await summaryTable(page).locator("tbody.fee-sku-group").getAttribute("data-sku")).toBe(
    " DRAFT.NEW ",
  );
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: /^Remove SKU:.*DRAFT\.NEW/ }).press("Enter");
  await expect(page.getByLabel("Search SKUs", { exact: true })).toBeFocused();
  await expect(summaryRows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Review changes/ })).toBeEnabled();
  await selectColumnOptions(page, "Company", ["Alpha Company"]);
  const menu = await openColumn(page, "SKU");
  await expect(menu.getByRole("checkbox", { name: "DRAFT.NEW", exact: true })).toBeVisible();
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("members filter only their authorized SKU catalog", async ({ page }) => {
  await setup(
    page,
    "member",
    [item("S1"), item("S-OWN"), item("S-OTHER", { company_id: OTHER_COMPANY })].map(
      (configuration, index) => ({
        ...configuration,
        sku_id: version(index + 1),
        terms_version_id: version(index + 101),
      }),
    ),
  );
  const menu = await openColumn(page, "SKU");
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await expect(menu.getByRole("checkbox", { name: "S-OTHER", exact: true })).toHaveCount(0);
  await menu.getByRole("checkbox", { name: "S-OWN", exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S-OWN")).toBeVisible();
  await page.reload();
  await expect(summaryRows(page)).toHaveCount(1);
  await expect(row(page, "S-OWN")).toBeVisible();
  const restored = await openColumn(page, "SKU");
  await restored.getByRole("button", { name: "Clear sku", exact: true }).click();
  await restored.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(summaryRows(page)).toHaveCount(2);
});

for (const width of [1440, 390]) {
  test(`folded periods select and edit one complete SKU group at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page, "administrator", [
      item("S1", {
        periods: [
          period("5", "2026-09-01", "2026-09-10"),
          period("7", "2026-09-10"),
          { ...period("0"), marketplace_name: "Amazon.co.jp" },
        ],
      }),
      item("S2"),
      item("S3", { company_id: null, periods: [] }),
    ]);
    const table = summaryTable(page);
    await expect(table.getByRole("columnheader").nth(2)).toHaveText("Fee periods");
    await expect(table.getByRole("columnheader").nth(3)).toContainText("Marketplace");
    await expect(table.getByRole("columnheader", { name: "Actions", exact: true })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Details", exact: true })).toHaveCount(0);
    await expect(summaryRows(page)).toHaveCount(3);
    await expect(feePeriods(page, "S1")).toHaveCount(0);
    const fold = feeGroup(page, "S1").getByRole("button", {
      name: "Show fee periods for S1",
      exact: true,
    });
    const periodCount = row(page, "S1").locator('[data-column="period-count"]');
    await expect(periodCount).toContainText("3 fee periods");
    await expect(
      periodCount.getByRole("button", { name: "Show fee periods for S1", exact: true }),
    ).toBeVisible();
    await expect(row(page, "S1").locator('[data-column="marketplace"]')).toHaveText(
      "2 marketplaces",
    );
    await expect(row(page, "S1").locator('[scope="rowgroup"] button')).toHaveCount(0);
    const heading = row(page, "S1").locator('[scope="rowgroup"] h3');
    await expect(heading).toHaveCSS("font-size", "13px");
    await expect(heading).toHaveCSS("font-weight", "500");
    const countBounds = await periodCount.locator(".fee-period-count > span").boundingBox();
    const marketplaceBounds = await row(page, "S1")
      .locator('[data-column="marketplace"]')
      .boundingBox();
    expect(countBounds.x + countBounds.width).toBeLessThanOrEqual(marketplaceBounds.x);
    const toggleBounds = await fold.boundingBox();
    expect(toggleBounds.y).toBeGreaterThanOrEqual(countBounds.y + countBounds.height);
    await fold.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(feePeriods(page, "S1")).toHaveCount(3);
    await expect(feePeriods(page, "S2")).toHaveCount(0);
    await expect(feeGroup(page, "S1").locator('[scope="rowgroup"]').first()).toHaveAttribute(
      "rowspan",
      "3",
    );
    await expect(feeGroup(page, "S1").getByRole("cell", { name: "0%", exact: true })).toBeVisible();
    const before = await table.boundingBox();
    await feePeriods(page, "S1").nth(1).press("Enter");
    await expect(feeDetails(page)).toBeVisible();
    const drawer = await feeDetails(page).elementHandle();
    await feeDetails(page).getByRole("button", { name: "Edit S1", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit S1", exact: true })).toBeVisible();
    expect(await editor(page).evaluate((element, previous) => element === previous, drawer)).toBe(
      true,
    );
    await expect(editor(page).getByLabel("Fee rate 3 (%)", { exact: true })).toHaveValue("0");
    await expect(feeGroup(page, "S1").locator('tr[aria-selected="true"]')).toHaveCount(3);
    await expect(feeGroup(page, "S2").locator('tr[aria-selected="true"]')).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Edit S1", exact: true })).toBeVisible();
    await expect(feePeriods(page, "S1")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toBeHidden();
    expect(await table.boundingBox()).toMatchObject({ width: before.width, height: before.height });
    await feePeriods(page, "S1").last().press("Space");
    await expect(feeDetails(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(feePeriods(page, "S1").last()).toBeFocused();
    await row(page, "S2").press("Space");
    await expect(
      feeDetails(page).getByRole("table", { name: "Marketplace fees for S2", exact: true }),
    ).toBeVisible();
    await expect(feeGroup(page, "S1").locator('tr[aria-selected="true"]')).toHaveCount(0);
    await expect(feeGroup(page, "S2").locator('tr[aria-selected="true"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(row(page, "S2")).toBeFocused();
    await expect(feeGroup(page, "S3").getByRole("button")).toHaveCount(0);
    await row(page, "S3").locator('[data-column="period-count"]').click();
    await expect(
      feeDetails(page).getByRole("button", { name: "Edit S3", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page, "S3")).toBeFocused();
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(feePeriods(page, "S1")).toHaveCount(3);
    await page.screenshot({
      path: testInfo.outputPath(`grouped-fees-${width}.png`),
      animations: "disabled",
    });
    await toggleFeePeriods(page, "S1");
    await expect(feePeriods(page, "S1")).toHaveCount(0);
    expect(fixture.configurationSaves).toHaveLength(0);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    ).toBe(true);
  });
}

test("fee folding and details remain keyboard accessible with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await toggleFeePeriods(page, "S1");
  await expect(feePeriods(page, "S1")).toHaveCount(1);
  await row(page, "S1").press("Enter");
  await expect(feeDetails(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(feeDetails(page)).toBeHidden();
  await expect(row(page, "S1")).toBeFocused();
});

test("discarding a new SKU draft removes its complete group and restores list focus", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add SKU", exact: true }).click();
  await editor(page).getByRole("combobox", { name: "SKU", exact: true }).fill("NEW-SKU");
  await editor(page).getByRole("button", { name: "Keep draft", exact: true }).click();
  await row(page, "NEW-SKU").press("Enter");
  await feeDetails(page)
    .getByRole("button", { name: "Discard draft for NEW-SKU", exact: true })
    .click();
  await expect(feeDetails(page)).toBeHidden();
  await expect(row(page, "NEW-SKU")).toHaveCount(0);
  await expect(page.locator(".fee-panel")).toBeFocused();
  await page.reload();
  await expect(editor(page)).toBeHidden();
});
