import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import { chooseFamilies } from "./financial-review-family-actions.mjs";

const categories = (page) => page.getByRole("tablist", { name: "Financial review", exact: true });
const summary = (page) => page.getByRole("region", { name: "2026 review totals", exact: true });

test("family investigation ranks absolute differences and isolates a family without changing the period", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await page.getByRole("button", { name: "Fee family breakdown", exact: true }).click();
  const table = page.getByRole("table", { name: "Yearly fee family breakdown", exact: true });
  await expect(table.locator("tbody tr").first()).toContainText("Future fee · Finances");
  await expect(table.locator("tbody tr").first()).toContainText("Finances-only family");
  await table
    .getByRole("button", { name: "Show only Monthly storage", exact: true })
    .press("Enter");
  await expect(summary(page).locator(".financial-review-summary-value").last()).toHaveText(
    "-5.01 USD",
  );
  await expect(page).toHaveURL(/family=monthly-storage/);
  await expect(page.getByRole("combobox", { name: "Year", exact: true })).toHaveValue("2026");
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveValue("USD");
  await expect(page.locator(".financial-review-months")).toBeFocused();
  await expect(table.locator("tbody tr")).toHaveCount(1);
});

test("a family with no records in another category offers direct recovery to all families", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage"]);
  await categories(page).getByRole("tab", { name: "Finances", exact: true }).click();
  const recover = page.getByRole("button", { name: "Show all families", exact: true });
  await expect(recover).toBeVisible();
  await recover.press("Enter");
  await expect(summary(page)).toBeVisible();
  await expect(page).not.toHaveURL(/family=/);
  await expect(
    categories(page).getByRole("tab", { name: "Finances", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".financial-review-months")).toBeFocused();
});

test("a zero-valued one-source period explains availability before its chart", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFinancialReview(page, (fixture) => {
    const common = {
      category: "SELBOX",
      marketplace_name: "Amazon.com",
      currency: "MXN",
      month: "2026-01-01",
    };
    fixture.financialReviewTotals = [
      {
        ...common,
        finances_amount: "0",
        data_kiosk_amount: "0",
        difference: "0",
        finances_row_count: "3",
        data_kiosk_row_count: "0",
      },
    ];
    fixture.financialReviewTypeTotals = [
      {
        ...common,
        source: "FINANCES",
        component_type: "OTHER_ADJUSTMENTS",
        amount: "0",
        row_count: "3",
      },
    ];
    fixture.financialReviewRecords = [];
  });
  await categories(page).getByRole("tab", { name: "SelBox", exact: true }).click();
  await expect(page.getByLabel("Amount currency: MXN", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveCount(0);
  await expect(summary(page).locator(".financial-review-summary-value")).toHaveText([
    "0.00 MXN",
    "0.00 MXN",
    "0.00 MXN",
  ]);
  const coverage = summary(page).getByRole("note", { name: "Source availability", exact: true });
  await expect(coverage).toContainText("No Data Kiosk records in this scope");
  await expect(coverage).toContainText("Finances: 3");
  await expect(coverage).toContainText("Data Kiosk: 0");
  await expectAccessible("one-source-zero-review");
});
