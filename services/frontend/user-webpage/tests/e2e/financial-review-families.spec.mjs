import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { expectFullyInViewport } from "./viewport-assertions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import {
  chooseFamilies,
  clearFamilies,
  familyTrigger,
  familyMenu,
} from "./financial-review-family-actions.mjs";

const year = (page) => page.getByRole("combobox", { name: "Year", exact: true });
const currency = (page) => page.getByRole("combobox", { name: "Currency", exact: true });
const overview = (page) =>
  page.getByRole("table", { name: "Monthly financial review", exact: true });
const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const category = (page, name) =>
  page
    .getByRole("tablist", { name: "Financial review", exact: true })
    .getByRole("tab", { name, exact: true });
const familyAmounts = (page, table, name) =>
  table
    .getByRole("row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .locator("td:nth-child(n + 2):nth-child(-n + 5)");

async function openMonth(page, month = "January 2026") {
  await overview(page)
    .getByRole("button", { name: `Open review for ${month}`, exact: true })
    .click();
  await expect(drawer(page).getByRole("heading", { name: month, exact: true })).toBeVisible();
}

async function expectMonth(page, month, amounts) {
  const row = overview(page)
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Open review for ${month}`, exact: true }) });
  await expect(row.getByRole("rowheader")).toHaveText(month);
  await expect(row.getByRole("cell")).toHaveText(amounts);
}

async function expectPeriod(page, values, selectedYear = "2026") {
  const summary = page.getByRole("region", { name: `${selectedYear} review totals`, exact: true });
  await expect(summary.locator(".financial-review-summary-value")).toHaveText(values);
}

test("Lightning Deal fees participate in the Deals family without changing their native type", async ({
  page,
}) => {
  await openFinancialReview(page, (fixture) => {
    const common = {
      month: "2026-07-01",
      category: "DATA_KIOSK",
      marketplace_name: "Amazon.com",
      currency: "USD",
    };
    fixture.financialReviewTotals = [
      {
        ...common,
        finances_amount: "-12",
        data_kiosk_amount: "-12",
        finances_row_count: "1",
        data_kiosk_row_count: "3",
      },
    ];
    fixture.financialReviewTypeTotals = [
      { source: "FINANCES", component_type: "DEAL_FEES", amount: "-12" },
      { source: "DATA_KIOSK", component_type: "RUN_LIGHTNING_DEAL_FEE", amount: "-5" },
      { source: "DATA_KIOSK", component_type: "DEAL_PARTICIPATION_FEE", amount: "-3" },
      { source: "DATA_KIOSK", component_type: "DEAL_PERFORMANCE_FEE", amount: "-4" },
    ].map((row) => ({ ...common, ...row, row_count: "1" }));
    fixture.financialReviewRecords = fixture.financialReviewTypeTotals.map((row, index) => ({
      ...row,
      activity_date: "2026-07-15",
      seller_namespace: "seller-one",
      sku: "DEAL-SKU",
      source_row_id: `0198b50b-701a-7000-8000-${String(index + 1).padStart(12, "0")}`,
      source_version_id: "0198b50b-701a-7000-8000-000000000020",
    }));
  });
  await chooseFamilies(page, ["Deals"]);
  await expectPeriod(page, ["-12.00 USD", "-12.00 USD", "0.00 USD"]);
  await openMonth(page, "July 2026");
  const types = drawer(page).getByRole("table", { name: "Amounts by type", exact: true });
  await expect(types.locator("tbody tr")).toHaveCount(4);
  const lightning = types
    .getByRole("row")
    .filter({ has: page.locator('[title$="RUN_LIGHTNING_DEAL_FEE"]') });
  await expect(lightning.getByRole("cell", { name: "-5.00", exact: true })).toBeVisible();
});

test("fee comparisons distinguish storage and advertising pairs and retain individual source identities", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await openMonth(page);
  await drawer(page).getByRole("button", { name: "Fee family comparison", exact: true }).click();
  const comparison = drawer(page).getByRole("table", {
    name: "Fee family comparison",
    exact: true,
  });
  for (const [name, values] of [
    ["Monthly storage", ["-10.00", "-8.00", "-2.00", "Both sources"]],
    ["Aged storage", ["-20.00", "-18.00", "-2.00", "Both sources"]],
    ["Sponsored products", ["-30.00", "-25.00", "-5.00", "Both sources"]],
    ["Future fee · Finances", ["-11.00", "0.00", "-11.00", "Finances-only family"]],
    ["Future fee · Data Kiosk", ["0.00", "-9.00", "9.00", "Data Kiosk-only family"]],
  ]) {
    await expect(familyAmounts(page, comparison, name)).toHaveText(values);
  }
  await expect(comparison.locator("tbody tr")).toHaveCount(5);
  await expect(drawer(page).getByText(/Unpaired or uncertain/)).toHaveCount(0);
  await expect(drawer(page).getByRole("table", { name: "Unpaired source types" })).toHaveCount(0);
  await drawer(page)
    .getByRole("navigation", { name: /^Review months/ })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(
    drawer(page).getByRole("heading", { name: "February 2026", exact: true }),
  ).toBeVisible();
  await drawer(page).getByRole("button", { name: "Fee family comparison", exact: true }).click();
  await expect(comparison.locator("tbody tr")).toHaveCount(3);
  for (const [name, values] of [
    ["Monthly storage", ["-4.00", "-1.00", "-3.00", "Both sources"]],
    ["Aged storage", ["-10.00", "-12.00", "2.00", "Both sources"]],
    ["Sponsored products", ["-5.00", "-10.00", "5.00", "Both sources"]],
  ]) {
    await expect(familyAmounts(page, comparison, name)).toHaveText(values);
  }
});

test("a union of families drives exact signed monthly, running, period and chart amounts, including cancelling rows", async ({
  page,
}, testInfo) => {
  await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  await expect(overview(page).locator("tbody tr")).toHaveCount(3);
  await expectMonth(page, "January 2026", ["-40.01", "-33.00", "-7.01", "-7.01"]);
  await expectMonth(page, "February 2026", ["-9.01", "-11.00", "1.99", "-5.01"]);
  await expectMonth(page, "March 2026", ["0.00", "0.00", "0.00", "-5.01"]);
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  await page.getByRole("button", { name: "Fee family breakdown", exact: true }).click();
  const breakdown = page.getByRole("table", { name: "Yearly fee family breakdown", exact: true });
  await expect(breakdown.locator("tbody tr")).toHaveCount(2);
  await expect(familyAmounts(page, breakdown, "Monthly storage")).toHaveText([
    "-14.01",
    "-9.00",
    "-5.01",
    "Both sources in 3 of 3 months",
  ]);
  await expect(familyAmounts(page, breakdown, "Sponsored products")).toHaveText([
    "-35.01",
    "-35.00",
    "-0.01",
    "Both sources in 3 of 3 months",
  ]);
  const chart = page.getByRole("figure", { name: "Monthly and running differences", exact: true });
  await expect(
    chart.getByRole("button", { name: "Feb: View chart details for February 2026" }),
  ).toHaveAttribute(
    "title",
    /^February 2026: Monthly difference 1\.99 USD; Running difference -5\.01 USD(?:\n|$)/,
  );
  await expect(
    chart.getByRole("button", { name: "Mar: View chart details for March 2026" }),
  ).toHaveAttribute(
    "title",
    /^March 2026: Monthly difference 0\.00 USD; Running difference -5\.01 USD(?:\n|$)/,
  );
  await page.screenshot({
    path: testInfo.outputPath("fee-family-overview-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await clearFamilies(page);
  await expectMonth(page, "January 2026", ["-71.01", "-60.00", "-11.01", "-11.01"]);
  await expectMonth(page, "February 2026", ["-19.01", "-23.00", "3.99", "-7.01"]);
  await expectPeriod(page, ["-90.02 USD", "-83.00 USD", "-7.01 USD"]);
  await expect(breakdown.locator("tbody tr")).toHaveCount(5);
});

test("an individual source family never includes the same unknown type from the other source", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Future fee · Finances"]);
  await expect(overview(page).locator("tbody tr")).toHaveCount(1);
  await expectMonth(page, "January 2026", [
    "-11.00",
    /^0\.00\s*No source records$/,
    "-11.00",
    "-11.00",
  ]);
  await openMonth(page);
  const types = drawer(page).getByRole("table", { name: "Amounts by type", exact: true });
  await expect(types.locator("tbody tr")).toHaveCount(1);
  await expect(types.locator("tbody tr")).toContainText("Finances");
  await types.getByRole("button", { name: /^View records/ }).click();
  const records = drawer(page).getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(records).toContainText("FINANCES:FUTURE_FEE");
  await expect(records).not.toContainText("DATA_KIOSK:FUTURE_FEE");
});

test("family scope survives year, currency, category, history and reload without treating no matches as all", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["monthly-storage", "sponsored-products"]);
  await currency(page).selectOption("EUR");
  await year(page).selectOption("2025");
  await expectPeriod(page, ["-300.00 EUR", "-270.00 EUR", "-30.00 EUR"], "2025");
  await page.reload();
  await expect(year(page)).toHaveValue("2025");
  await expect(currency(page)).toHaveValue("EUR");
  await expectPeriod(page, ["-300.00 EUR", "-270.00 EUR", "-30.00 EUR"], "2025");
  await year(page).selectOption("2026");
  await currency(page).selectOption("USD");
  await category(page, "Finances").click();
  await expect(overview(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  await expect(page.getByRole("figure", { name: "Monthly and running differences" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("region", { name: "2026 review totals" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fee family breakdown", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Fee family breakdown", exact: true }),
  ).toContainText(
    "No source types match these fee families for Amazon.com in this year and currency.",
  );
  await expect(
    page.getByRole("table", { name: "Yearly fee family breakdown", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(category(page, "Data Kiosk")).toHaveAttribute("aria-selected", "true");
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  await page.reload();
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  await category(page, "Finances").click();
  await clearFamilies(page);
  await expectMonth(page, "January 2026", ["7.00", "6.00", "1.00", "1.00"]);
});

test("monthly totals, alias types and source records keep the selected family union through navigation and reload", async ({
  page,
}) => {
  await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  await openMonth(page, "February 2026");
  await expect(drawer(page)).toContainText("Fee families: Monthly storage, Sponsored products");
  await expect(
    drawer(page).getByRole("heading", { name: "Selected fee family totals", exact: true }),
  ).toBeVisible();
  await expect(drawer(page)).toContainText(
    "This comparison is diagnostic and never changes transaction amounts or saved payouts.",
  );
  const totals = drawer(page).getByRole("table", { name: "Financial review totals", exact: true });
  await expect(totals.locator("tbody tr").getByRole("cell")).toHaveText([
    "-9.01",
    "-11.00",
    "1.99",
  ]);
  const types = drawer(page).getByRole("table", { name: "Amounts by type", exact: true });
  await expect(types.locator("tbody tr")).toHaveCount(4);
  await expect(types.locator('[title$="MONTHLY_INVENTORY_STORAGE_FEE"]')).toHaveCount(1);
  await expect(types.locator('[title$="SPONSORED_PRODUCTS_CHARGE"]')).toHaveCount(1);
  await expect(types.locator('[title$="AGED_STORAGE_FEES"]')).toHaveCount(0);
  await types
    .getByRole("row")
    .filter({ has: page.locator('[title$="SPONSORED_PRODUCTS_CHARGE"]') })
    .getByRole("button", { name: /^View records/ })
    .click();
  const records = drawer(page).getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(records).toContainText("DATA_KIOSK:SPONSORED_PRODUCTS_CHARGE");
  await drawer(page).getByRole("button", { name: "Clear selected type", exact: true }).click();
  await drawer(page).getByRole("combobox", { name: "Record source", exact: true }).selectOption("");
  await expect(records.locator("tbody tr")).toHaveCount(4);
  await expect(records).not.toContainText("AGED_STORAGE");
  await page.reload();
  await expect(records.locator("tbody tr")).toHaveCount(4);
  await expect(totals.locator("tbody tr").getByRole("cell")).toHaveText([
    "-9.01",
    "-11.00",
    "1.99",
  ]);
  await drawer(page)
    .getByRole("navigation", { name: /^Review months/ })
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(
    drawer(page).getByRole("heading", { name: "March 2026", exact: true }),
  ).toBeVisible();
  await expect(totals.locator("tbody tr").getByRole("cell")).toHaveText(["0.00", "0.00", "0.00"]);
  await expect(types.locator("tbody tr")).toHaveCount(5);
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(6);
  await expect(records.getByRole("cell", { name: "0.00", exact: true })).toHaveCount(2);
  await expect(records.getByRole("cell", { name: "-12.50", exact: true })).toHaveCount(2);
  await expect(records.getByRole("cell", { name: "12.50", exact: true })).toHaveCount(2);
});

test("a failed family catalog keeps filtered totals unavailable while retry and clear remain usable", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  const isYearCatalog = ({ endpoint, params }) =>
    endpoint === "financial_review_type_totals" &&
    params.get("p_month_from") === "2026-01-01" &&
    params.get("p_month_to") === "2026-08-01";
  const failCatalog = (request) => (isYearCatalog(request) ? 503 : 200);
  fixture.financialReviewStatusForRequest = failCatalog;
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry fee families", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("region", { name: "2026 review totals", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("figure", { name: "Monthly and running differences", exact: true }),
  ).toHaveCount(0);
  await expect(overview(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  await expect(overview(page)).toContainText("Monthly summaries are unavailable.");
  await expect(familyTrigger(page)).toBeEnabled();

  async function retryWithPendingFocus() {
    let releaseCatalog;
    fixture.beforeFinancialReview = (request) =>
      isYearCatalog(request)
        ? new Promise((resolve) => {
            releaseCatalog = resolve;
          })
        : undefined;
    fixture.financialReviewStatusForRequest = null;
    await retry.press("Enter");
    await expect.poll(() => typeof releaseCatalog).toBe("function");
    try {
      await expect(familyTrigger(page)).toBeEnabled();
      await expect(familyTrigger(page)).toBeFocused();
    } finally {
      releaseCatalog();
    }
    await expect(retry).toBeHidden();
    fixture.beforeFinancialReview = () => {};
  }
  await retryWithPendingFocus();
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["monthly-storage", "sponsored-products"]);

  fixture.financialReviewStatusForRequest = failCatalog;
  await page.reload();
  await expect(retry).toBeVisible();
  await familyTrigger(page).press("Enter");
  const failedMenu = familyMenu(page);
  await expect(failedMenu.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await failedMenu.getByRole("button", { name: "Clear fee families", exact: true }).press("Enter");
  await expect(failedMenu.getByRole("checkbox")).toHaveCount(0);
  const close = failedMenu.getByRole("button", { name: "Close options", exact: true });
  await expect(close).toBeFocused();
  await close.press("Enter");
  await expect(failedMenu).toBeHidden();
  await expect(familyTrigger(page)).toBeFocused();
  await expectPeriod(page, ["-90.02 USD", "-83.00 USD", "-7.01 USD"]);
  await expectMonth(page, "January 2026", ["-71.01", "-60.00", "-11.01", "-11.01"]);
  await expect(retry).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll("family")).toEqual([]);
  await retryWithPendingFocus();
  await expectPeriod(page, ["-90.02 USD", "-83.00 USD", "-7.01 USD"]);
});

test("an empty review without a resolved year settles without requesting or loading a family breakdown", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, (state) => {
    state.financialReviewTotals = [];
    state.financialReviewTypeTotals = [];
    state.financialReviewRecords = [];
  });
  await expect(overview(page)).toContainText("No mature source records for Amazon.com.");
  await expect(year(page)).toBeDisabled();
  await expect(year(page).locator("option")).toHaveText(["No years"]);
  await expect(familyTrigger(page)).toBeEnabled();
  await familyTrigger(page).click();
  await expect(familyMenu(page)).toContainText("No options available.");
  await expect(
    familyMenu(page).getByRole("button", { name: "Clear fee families", exact: true }),
  ).toBeDisabled();
  await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fee family breakdown", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Loading fee family breakdown…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry fee families", exact: true })).toHaveCount(
    0,
  );
  expect(
    fixture.financialReviewRequests.filter(
      ({ endpoint }) => endpoint !== "financial_review_records",
    ),
  ).toHaveLength(0);
});

test("source coverage failures keep selected family comparisons unavailable until retry", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  fixture.financialReviewStatusForRequest = ({ endpoint }) =>
    endpoint === "current_source_totals" ? 503 : 200;
  await page.reload();
  const retry = page.getByRole("button", { name: "Retry source totals", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("alert").filter({ has: retry })).toContainText(
    "Could not load source coverage and available currencies.",
  );
  await expect(page.getByLabel("Amount currency: USD", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "2026 review totals", exact: true })).toHaveCount(
    0,
  );
  fixture.financialReviewStatusForRequest = null;
  await retry.press("Enter");
  await expect(retry).toBeHidden();
  await expect(currency(page).locator("option")).toHaveText(["EUR", "USD"]);
  await expect(currency(page)).toHaveValue("USD");
  await expect(year(page)).toHaveValue("2026");
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  expect(new URL(page.url()).searchParams.getAll("family")).toEqual([
    "monthly-storage",
    "sponsored-products",
  ]);
});

test("monthly family comparison reports a failed coverage read and retries both inputs", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupFamilies);
  await chooseFamilies(page, ["Monthly storage", "Sponsored products"]);
  fixture.financialReviewStatusForRequest = ({ endpoint, params }) =>
    endpoint === "current_source_totals" && params.get("p_start") === "2026-02-01" ? 503 : 200;
  await openMonth(page, "February 2026");
  const retry = drawer(page).getByRole("button", { name: "Retry account totals", exact: true });
  await expect(retry).toBeVisible();
  await expect(drawer(page)).not.toContainText(
    "No source data for Amazon.com in USD in this month.",
  );
  fixture.financialReviewStatusForRequest = null;
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(
    drawer(page).getByRole("table", { name: "Financial review totals", exact: true }),
  ).toContainText("1.99");
});

test("phone keyboard selection keeps fee-family controls reachable and accessible", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFinancialReview(page, setupFamilies);
  const trigger = familyTrigger(page);
  await trigger.focus();
  await trigger.press("Enter");
  const options = familyMenu(page);
  await expect(options).toBeVisible();
  for (const name of ["Monthly storage", "Sponsored products"]) {
    const checkbox = options.getByRole("checkbox", { name, exact: true });
    await checkbox.press("Space");
    await expect(checkbox).toBeChecked();
  }
  await expectAccessible("fee-family-options-phone");
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("data-filtered", "true");
  await expectPeriod(page, ["-49.02 USD", "-44.00 USD", "-5.01 USD"]);
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("fee-family-overview-phone.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expectAccessible("fee-family-overview-phone");
  await trigger.press("Enter");
  const clear = options.getByRole("button", { name: "Clear fee families", exact: true });
  await expectFullyInViewport(clear);
  await clear.press("Enter");
  await expect(options.getByRole("checkbox").first()).toBeFocused();
  await expect(clear).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectPeriod(page, ["-90.02 USD", "-83.00 USD", "-7.01 USD"]);
});
