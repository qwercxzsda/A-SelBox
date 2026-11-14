import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { chooseFamilies } from "./financial-review-family-actions.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";

const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const totals = (page) =>
  drawer(page).getByRole("region", { name: "Financial review totals", exact: true });

async function expectAmountsFit(page) {
  for (const amount of await totals(page).locator("dd").all()) {
    await expectFullyInViewport(amount);
    expect(await amount.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
  }
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
}

for (const width of [320, 390]) {
  test(`monthly family totals expose every amount without horizontal scrolling at ${width}px`, async ({
    page,
    expectAccessible,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openFinancialReview(page, (fixture) => {
      const common = {
        month: "2026-07-01",
        category: "DATA_KIOSK",
        marketplace_name: "Amazon.com",
        currency: "USD",
      };
      fixture.financialReviewTypeTotals = [
        {
          ...common,
          source: "FINANCES",
          component_type: "STORAGE_FEES",
          amount: "-42.04",
          row_count: "1",
        },
        {
          ...common,
          source: "DATA_KIOSK",
          component_type: "FBA_STORAGE_FEE",
          amount: "-48.34",
          row_count: "14",
        },
        {
          ...common,
          source: "FINANCES",
          component_type: "ADVERTISING",
          amount: "-8535.86",
          row_count: "17",
        },
        {
          ...common,
          source: "DATA_KIOSK",
          component_type: "SPONSORED_PRODUCT_FEE",
          amount: "-6875.46",
          row_count: "187",
        },
      ];
    });
    await chooseFamilies(page, ["Monthly storage fees", "Sponsored products"]);
    await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
    await expect(totals(page).locator("dt")).toHaveText([
      "Finances costs",
      "Data Kiosk costs",
      "Source gap",
    ]);
    await expect(totals(page).locator("dd")).toHaveText(["-8,577.90", "-6,923.80", "-1,654.10"]);
    await expect(totals(page).getByText("No source records", { exact: true })).toHaveCount(0);
    await expectAmountsFit(page);
    await expectAccessible(`monthly-family-totals-${width}`);
    await page.screenshot({
      path: testInfo.outputPath(`monthly-totals-${width}.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const table = drawer(page).getByRole("table", { name: "Financial review totals", exact: true });
    await expect(table.locator("tbody tr").getByRole("cell")).toHaveText([
      "-8,577.90",
      "-6,923.80",
      "-1,654.10",
    ]);
    await expect(totals(page)).toHaveCount(0);
  });

  test(`monthly totals distinguish zero activity from a source with no records at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openFinancialReview(page, (fixture) => {
      const row = fixture.financialReviewTotals.find((row) => row.category === "SELBOX");
      Object.assign(row, {
        finances_amount: "0",
        data_kiosk_amount: "0",
        difference: "0",
        finances_row_count: "2",
        data_kiosk_row_count: "0",
      });
    });
    await page
      .getByRole("tablist", { name: "Financial review", exact: true })
      .getByRole("tab", { name: "SelBox", exact: true })
      .click();
    await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
    await expect(totals(page).locator("dt")).toHaveText([
      "Finances amount",
      "Data Kiosk amount",
      "Source gap",
    ]);
    await expect(totals(page).locator("dd").nth(0)).toHaveText("0.00");
    await expect(totals(page).locator("dd").nth(1)).toContainText("No source records");
    await expect(totals(page).locator("dd").nth(2)).toHaveText("0.00");
    await expect(totals(page).getByText("No source records", { exact: true })).toHaveCount(1);
    await expectAmountsFit(page);
  });
}
