import { expect, test } from "@playwright/test";
import { liveRow } from "./api-fixtures.mjs";
import {
  COMPANY,
  item,
  setup,
  stageRate,
  feeRow,
  feeDetails,
  editor,
  openEditor,
} from "./sku-configuration-fixtures.mjs";
import { applyDates, openColumn, sortBy } from "./table-actions.mjs";

const SKU = 'SKU (A), "blue" / 50%';
const transactionTable = (page) =>
  page.getByRole("table", { name: "Financial records", exact: true });

for (const role of ["administrator", "member"]) {
  test(`${role} opens all exact-SKU transactions from fees and retains the selection after F5`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: role === "administrator" ? 1440 : 390, height: 1000 });
    const fixture = await setup(page, role, [item("S1"), item(SKU)], (fixture) => {
      fixture.liveRows = Array.from({ length: 60 }, (_, index) => ({
        ...liveRow("NAVIGATION", index + 1, COMPANY),
        sku: index < 30 ? SKU : `${SKU}-EXTRA`,
        activity_date: "2026-09-02",
      }));
    });
    const record = feeRow(page, SKU);
    await expect(record).toHaveAttribute("aria-selected", "false");
    await expect(record).toHaveAttribute("aria-haspopup", "dialog");
    await expect(record).toContainText("1 fee period");
    await expect(
      record.getByRole("button", { name: `Show transactions for ${SKU}`, exact: true }),
    ).toHaveCount(0);
    await expect(record.getByRole("button", { name: `Edit ${SKU}`, exact: true })).toHaveCount(0);
    if (role === "administrator") {
      await stageRate(page, "6.123456");
      await feeRow(page, "S1").press("Enter");
      await expect(
        feeDetails(page)
          .getByRole("table", { name: "Marketplace fees for S1", exact: true })
          .getByRole("cell", { name: "6.123456%", exact: true }),
      ).toBeInViewport();
      await feeDetails(page)
        .getByRole("button", { name: "Close fee details", exact: true })
        .click();
    }
    await page.screenshot({
      path: testInfo.outputPath(`fee-list-${role}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await sortBy(page, "Date (UTC)", "Oldest first");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
    await applyDates(page, "2026-01-01", "2026-01-31");
    await page.getByLabel("Search", { exact: true }).fill("unrelated search");
    const oldSkuMenu = await openColumn(page, "SKU");
    await oldSkuMenu.getByRole("checkbox", { name: "S1", exact: true }).check();
    await oldSkuMenu.getByRole("button", { name: "Close options", exact: true }).click();
    await expect(page.getByText("No matching records", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await record.press("Enter");
    await feeDetails(page)
      .getByRole("button", { name: `Show transactions for ${SKU}`, exact: true })
      .press("Enter");
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeInViewport();
    await expect(transactionTable(page).getByRole("cell", { name: SKU, exact: true })).toHaveCount(
      30,
    );
    await expect(
      transactionTable(page).getByRole("cell", { name: `${SKU}-EXTRA`, exact: true }),
    ).toHaveCount(0);
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
    await expect(transactionTable(page).getByRole("cell", { name: SKU, exact: true })).toHaveCount(
      30,
    );
    expect(fixture.requests.at(-1).args.p_skus).toEqual([SKU]);
    const selectedSkuMenu = await openColumn(page, "SKU");
    await expect(selectedSkuMenu.getByRole("checkbox", { name: SKU, exact: true })).toBeChecked();
    await selectedSkuMenu.getByRole("button", { name: "Close options", exact: true }).click();

    await page.getByRole("tab", { name: "Current fees", exact: true }).click();
    await expect(record).toHaveAttribute("aria-selected", "false");
    if (role === "administrator") {
      await expect(page.getByText("1 SKU draft · not saved yet", { exact: true })).toBeVisible();
      await feeRow(page, "S1").press("Enter");
      await expect(
        feeDetails(page).getByRole("table", { name: "Marketplace fees for S1", exact: true }),
      ).toContainText("6.123456%");
    }
    expect(fixture.configurationSaves).toHaveLength(0);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize().width);
  });
}

test("opening transactions from the editor preserves unfinished SKU changes", async ({ page }) => {
  const fixture = await setup(page, "administrator", [item("S1")], (fixture) => {
    fixture.liveRows = [{ ...liveRow("NAVIGATION", 1, COMPANY), sku: "S1" }];
  });
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.123456");
  await editor(page).getByRole("button", { name: "View transactions for S1", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(transactionTable(page).getByRole("cell", { name: "S1", exact: true })).toHaveCount(
    1,
  );
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(page.getByRole("region", { name: "Fee changes" })).toContainText(
    "1 unfinished edit",
  );
  await openEditor(page);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.123456");
  expect(fixture.configurationSaves).toHaveLength(0);
});
