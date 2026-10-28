import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { chooseFamilies, familyMenu } from "./financial-review-family-actions.mjs";
import { setupEconomicFamilies } from "./financial-review-economic-fixtures.mjs";

const categoryTab = (page, name) =>
  page
    .getByRole("tablist", { name: "Financial review", exact: true })
    .getByRole("tab", { name, exact: true });
const breakdown = (page) =>
  page.getByRole("table", { name: "Yearly fee family breakdown", exact: true });
const familyRow = (page, label) =>
  breakdown(page)
    .getByRole("row")
    .filter({ has: page.getByText(label, { exact: true }) });
const periodAmounts = (page) =>
  page
    .getByRole("region", { name: "2026 review totals", exact: true })
    .locator(".financial-review-summary-value");

test("unequal source memberships show net sales and fulfillment differences rather than separate gross offsets", async ({
  page,
  expectAccessible,
}) => {
  const fixture = await openFinancialReview(page, setupEconomicFamilies);
  await categoryTab(page, "Finances").click();
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
  await page.getByRole("button", { name: "Fee family breakdown", exact: true }).click();
  await expect(breakdown(page).locator("tbody tr")).toHaveCount(2);
  for (const [label, amounts] of [
    ["Net product sales", ["80.00", "80.00", "0.00"]],
    ["FBA fulfillment", ["-4.00", "-4.00", "0.00"]],
  ]) {
    const row = familyRow(page, label);
    await expect(row.locator("td:nth-child(n + 2):nth-child(-n + 4)")).toHaveText(amounts);
    await expect(row).toContainText("Both sources");
  }
  const sales = familyRow(page, "Net product sales");
  await sales.locator("summary").click();
  await expect(sales).toContainText(
    "Defined Finances types: PRODUCT_SALES, PRODUCT_REFUNDS, ZERO_ACTIVITY",
  );
  await expect(sales).toContainText("Defined Data Kiosk types: NET_PRODUCT_SALES");
  await sales.getByRole("button", { name: "Show only Net product sales", exact: true }).click();
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  const legend = page.getByRole("list", { name: "Fee family legend", exact: true });
  await expect(legend.locator("li")).toHaveCount(1);
  await expect(legend.locator(".financial-review-chart-source-only")).toHaveCount(0);
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(
    drawer.getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(4);
  const monthlyTypeFilter = () =>
    fixture.financialReviewRequests
      .find(
        ({ endpoint, params, completed }) =>
          completed &&
          endpoint === "financial_review_type_totals" &&
          params.get("p_category") === "FINANCES" &&
          params.get("p_month_from") === "2026-01-01" &&
          params.get("p_month_to") === "2026-02-01" &&
          params.get("p_currency") === "USD" &&
          params.get("limit") === "50" &&
          params.get("offset") === "0",
      )
      ?.params.get("or");
  await expect
    .poll(monthlyTypeFilter)
    .toContain('"PRODUCT_SALES","PRODUCT_REFUNDS","ZERO_ACTIVITY"');
  expect(monthlyTypeFilter()).toContain(
    'source.eq.DATA_KIOSK,component_type.in.("NET_PRODUCT_SALES")',
  );
  await expectAccessible("net-economic-family-month");
});

test("SelBox groups account purposes and retains a zero balance without inventing a Kiosk counterpart", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFinancialReview(page, setupEconomicFamilies);
  await categoryTab(page, "SelBox").click();
  await expect(periodAmounts(page)).toHaveText(["-12.00 USD", "-5.00 USD", "-7.00 USD"]);
  await page.getByRole("button", { name: "Fee family breakdown", exact: true }).click();
  await expect(breakdown(page).locator("tbody tr")).toHaveCount(5);
  await expect(familyRow(page, "Seller service fees").locator("td").nth(3)).toHaveText("-9.00");
  const balance = familyRow(page, "Balance movements");
  await expect(balance.locator("td:nth-child(n + 2):nth-child(-n + 5)")).toHaveText([
    "0.00",
    "0.00",
    "0.00",
    "Finances-only family",
  ]);
  await balance.locator("summary").click();
  await expect(balance).toContainText("Defined Data Kiosk types: No counterpart defined");
  await expect(balance).toContainText(
    "Observed Finances types: CROSS_ACCOUNT_ADJUSTMENTS, DEBT_RECOVERY, RESERVE_MOVEMENTS",
  );
  await expect(familyRow(page, "Subscription")).toContainText("Both sources");
  await chooseFamilies(page, ["Balance movements", "Subscription"]);
  await expect(familyMenu(page)).toBeHidden();
  await expect(periodAmounts(page)).toHaveText(["-5.00 USD", "-5.00 USD", "0.00 USD"]);
  await expect(breakdown(page).locator("tbody tr")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible("selbox-economic-families-phone");
});

test("retired family links migrate to one selected net-sales family across reload and browser history", async ({
  page,
}) => {
  await openFinancialReview(page, setupEconomicFamilies);
  await page.goto(
    "/?tab=financial-review&category=FINANCES&year=2026&currency=USD&family=product-sales&family=product-refunds",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["net-product-sales"]);
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await page.reload();
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await chooseFamilies(page, ["FBA fulfillment"]);
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["net-product-sales"]);
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await page.goForward();
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
});
