import { expect, test } from "./accessibility-fixture.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { chooseFamilies, familyMenu, familyTrigger } from "./financial-review-family-actions.mjs";
import { setupEconomicFamilies } from "./financial-review-economic-fixtures.mjs";

const categoryTab = (page, name) =>
  page
    .getByRole("tablist", { name: "Financial review", exact: true })
    .getByRole("tab", { name, exact: true });
const breakdown = (page) =>
  page.getByRole("region", { name: "Yearly type family breakdown", exact: true });
const familyRow = (page, label) =>
  breakdown(page)
    .getByRole("row")
    .filter({ has: page.getByText(label, { exact: true }) });
const periodAmounts = (page) =>
  page
    .getByRole("region", { name: "2026 review totals", exact: true })
    .locator(".financial-review-summary-value");

test("different reporting bases and paired families stay separate without changing source totals", async ({
  page,
  expectAccessible,
}, testInfo) => {
  const fixture = await openFinancialReview(page, setupEconomicFamilies);
  await categoryTab(page, "Finances").click();
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
  await page.getByRole("button", { name: "Type family breakdown", exact: true }).click();
  await expect(breakdown(page).locator("tbody tr")).toHaveCount(6);
  for (const [label, amounts] of [
    ["Customer sales and refunds", ["80.00", "80.00", "0.00"]],
    ["FBA fulfillment fees", ["-4.00", "-4.00", "0.00"]],
  ]) {
    const row = familyRow(page, label);
    await expect(row.locator("td:nth-child(n + 2):nth-child(-n + 4)")).toHaveText(amounts);
    await expect(row).toContainText("Both sources");
  }
  const paired = breakdown(page).getByRole("table", {
    name: "Yearly paired type families",
    exact: true,
  });
  const differentBasis = breakdown(page).getByRole("table", {
    name: "Yearly different reporting basis",
    exact: true,
  });
  await expect(paired).toContainText("FBA fulfillment fees");
  await expect(differentBasis).toContainText("Customer sales and refunds");
  await expect(differentBasis.getByRole("columnheader", { name: /Source gap/ })).toHaveCount(1);
  await expect(differentBasis.getByRole("columnheader", { name: /Difference/ })).toHaveCount(0);
  const zero = familyRow(page, "Zero-value activity");
  await expect(zero.locator("td").nth(1)).toHaveText("0.00");
  await expect(zero).toContainText("Finances mapping only");
  for (const [label, amount] of [
    ["Loyalty points", "-3.00"],
    ["Amazon shipping fees", "-1.00"],
    ["Taxes collected and withheld", "4.00"],
  ]) {
    const row = familyRow(page, label);
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").nth(1)).toHaveText(amount);
    await expect(row).toContainText("No mapped type");
  }
  const sales = familyRow(page, "Customer sales and refunds");
  const tableHeight = (await breakdown(page).boundingBox()).height;
  await sales
    .getByRole("button", { name: "Family definition for Customer sales and refunds", exact: true })
    .click();
  const salesDefinition = page.locator(".help-popover");
  await expect(salesDefinition).toContainText(
    "Defined Finances types: PRODUCT_SALES, PRODUCT_REFUNDS, PROMOTIONAL_REBATES, PROMOTIONAL_REFUNDS, SHIPPING_CREDITS, SHIPPING_REFUNDS",
  );
  await expect(salesDefinition).toContainText("Defined Data Kiosk types: NET_PRODUCT_SALES");
  expect((await breakdown(page).boundingBox()).height).toBe(tableHeight);
  await page.screenshot({
    path: testInfo.outputPath("family-definition-desktop.png"),
    animations: "disabled",
  });
  await salesDefinition
    .getByRole("button", {
      name: "Close Family definition for Customer sales and refunds",
      exact: true,
    })
    .click();
  await expect(salesDefinition).toBeHidden();
  await sales
    .getByRole("button", { name: "Show only Customer sales and refunds", exact: true })
    .click();
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  const legend = page.getByRole("list", { name: "Type family legend", exact: true });
  await expect(legend.locator("li")).toHaveCount(1);
  await expect(legend).toContainText("Different reporting basis");
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(
    drawer.getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(7);
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
    .toContain(
      '"PRODUCT_SALES","PRODUCT_REFUNDS","PROMOTIONAL_REBATES","PROMOTIONAL_REFUNDS","SHIPPING_CREDITS","SHIPPING_REFUNDS"',
    );
  expect(monthlyTypeFilter()).toContain(
    'source.eq.DATA_KIOSK,component_type.in.("NET_PRODUCT_SALES")',
  );
  await drawer.getByRole("button", { name: "Source records", exact: true }).click();
  const records = drawer.getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(7);
  for (const type of [
    "PRODUCT_SALES",
    "PRODUCT_REFUNDS",
    "PROMOTIONAL_REBATES",
    "PROMOTIONAL_REFUNDS",
    "SHIPPING_CREDITS",
    "SHIPPING_REFUNDS",
    "NET_PRODUCT_SALES",
  ])
    await expect(records.locator(`[title~="${type}"]`)).toHaveCount(1);
  for (const type of ["POINTS", "SHIPPING_CHARGEBACKS", "PRODUCT_TAX"])
    await expect(records.locator(`[title~="${type}"]`)).toHaveCount(0);
  await expect
    .poll(() =>
      fixture.financialReviewRequests
        .find(
          ({ endpoint, params, completed }) =>
            completed &&
            endpoint === "financial_review_records" &&
            params.get("select") !== "activity_date",
        )
        ?.params.get("or"),
    )
    .toBe(monthlyTypeFilter());
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expectAccessible("net-economic-family-month");
});

test("customer-sales family membership stays global when marketplace changes and the selection reloads", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, (fixture) => {
    setupEconomicFamilies(fixture);
    for (const field of [
      "financialReviewTotals",
      "financialReviewTypeTotals",
      "financialReviewRecords",
    ])
      fixture[field].push(
        ...fixture[field]
          .filter((row) => row.category === "FINANCES")
          .map((row) => ({ ...row, marketplace_name: "Amazon.co.jp", currency: "JPY" })),
      );
  });
  await categoryTab(page, "Finances").click();
  await chooseFamilies(page, ["Customer sales and refunds"]);
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await page
    .getByRole("combobox", { name: "Marketplace", exact: true })
    .selectOption("Amazon.co.jp");
  await expect(periodAmounts(page)).toHaveText(["80.00 JPY", "80.00 JPY", "0.00 JPY"]);
  await page.reload();
  await expect(periodAmounts(page)).toHaveText(["80.00 JPY", "80.00 JPY", "0.00 JPY"]);
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["net-product-sales"]);
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await drawer.getByRole("button", { name: "Source records", exact: true }).click();
  await expect(
    drawer.getByRole("table", { name: "Source records", exact: true }).locator("tbody tr"),
  ).toHaveCount(7);
  await expect
    .poll(() =>
      fixture.financialReviewRequests
        .find(
          ({ endpoint, params, completed }) =>
            completed &&
            endpoint === "financial_review_records" &&
            params.get("marketplace_name") === "eq.Amazon.co.jp" &&
            params.get("select") !== "activity_date",
        )
        ?.params.get("or"),
    )
    .toBe(
      '(and(source.eq.FINANCES,component_type.in.("PRODUCT_SALES","PRODUCT_REFUNDS","PROMOTIONAL_REBATES","PROMOTIONAL_REFUNDS","SHIPPING_CREDITS","SHIPPING_REFUNDS")),and(source.eq.DATA_KIOSK,component_type.in.("NET_PRODUCT_SALES")))',
    );
});

test("SelBox groups account purposes and retains a zero balance without inventing a Kiosk counterpart", async ({
  page,
  expectAccessible,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFinancialReview(page, setupEconomicFamilies);
  await categoryTab(page, "SelBox").click();
  await expect(periodAmounts(page)).toHaveText(["-12.00 USD", "-5.00 USD", "-7.00 USD"]);
  await page.getByRole("button", { name: "Type family breakdown", exact: true }).click();
  await expect(breakdown(page).locator("tbody tr")).toHaveCount(8);
  for (const [family, amount] of [
    ["EPR compliance fees", "-2.00"],
    ["Vine enrollment fees", "-3.00"],
    ["Inbound defect fees", "-4.00"],
    ["Supply-chain credits", "2.00"],
    ["Other account adjustments", "-1.00"],
  ])
    await expect(familyRow(page, family).locator("td").nth(1)).toHaveText(amount);
  const unmatched = breakdown(page).getByRole("table", {
    name: "Yearly unpaired activity",
    exact: true,
  });
  await expect(unmatched.getByRole("columnheader", { name: /Difference|Source gap/ })).toHaveCount(
    0,
  );
  await expect(unmatched).toContainText("No mapped type");
  const balance = familyRow(page, "Balance movements");
  await expect(balance.locator("td:nth-child(n + 2):nth-child(-n + 5)")).toHaveText([
    "0.00",
    "No mapped type",
    "Finances mapping only",
    "Show only",
  ]);
  await balance
    .getByRole("button", { name: "Family definition for Balance movements", exact: true })
    .click();
  const balanceDefinition = page.locator(".help-popover");
  await expect(balanceDefinition).toContainText("Defined Data Kiosk types: No mapped type");
  await expect(balanceDefinition).toContainText(
    "Observed Finances types: CROSS_ACCOUNT_ADJUSTMENTS, DEBT_RECOVERY, RESERVE_MOVEMENTS",
  );
  await page.screenshot({
    path: testInfo.outputPath("family-definition-phone.png"),
    animations: "disabled",
  });
  await balanceDefinition
    .getByRole("button", { name: "Close Family definition for Balance movements", exact: true })
    .click();
  await expect(balanceDefinition).toBeHidden();
  await expect(familyRow(page, "Seller subscription fees")).toContainText("Both sources");
  await chooseFamilies(page, ["Balance movements", "Seller subscription fees"]);
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

test("current family links deduplicate and retain selection across reload and browser history", async ({
  page,
}) => {
  await openFinancialReview(page, setupEconomicFamilies);
  await page.goto(
    "/?tab=financial-review&category=FINANCES&year=2026&currency=USD&family=net-product-sales&family=net-product-sales",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["net-product-sales"]);
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await page.reload();
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await chooseFamilies(page, ["FBA fulfillment fees"]);
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll("family"))
    .toEqual(["net-product-sales"]);
  await expect(periodAmounts(page)).toHaveText(["80.00 USD", "80.00 USD", "0.00 USD"]);
  await page.goForward();
  await expect(periodAmounts(page)).toHaveText(["76.00 USD", "76.00 USD", "0.00 USD"]);
});

test("an unpaired selection retains totals and exact records without inventing a comparison or retry error", async ({
  page,
  expectAccessible,
}) => {
  await openFinancialReview(page, (fixture) => {
    setupEconomicFamilies(fixture);
    fixture.currentSourceCoverage = [
      {
        source: "FINANCES",
        seller_namespace: "seller-one",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      },
    ];
  });
  await categoryTab(page, "SelBox").click();
  await familyTrigger(page).click();
  const option = familyMenu(page).getByRole("checkbox", {
    name: "EPR compliance fees",
    exact: true,
  });
  await expect(option).toHaveAccessibleDescription("No verified Data Kiosk mapping");
  await expect(
    familyMenu(page).getByRole("checkbox", { name: "Seller subscription fees", exact: true }),
  ).toHaveAccessibleDescription("Paired sources");
  await option.check();
  await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(periodAmounts(page)).toHaveText(["-2.00 USD", "No mapped types", "-2.00 USD"]);
  const availability = page
    .getByRole("region", { name: "2026 review totals", exact: true })
    .getByRole("note", { name: "Source availability", exact: true });
  await expect(availability).toContainText(
    "No Data Kiosk types are mapped for the selected families.",
  );
  await expect(availability).toContainText("Records · Finances: 1 · Data Kiosk: No mapped types");
  await expect(availability).not.toContainText(
    /shown as zero|coverage is incomplete|No Data Kiosk records/,
  );
  await expect(
    page
      .getByRole("table", { name: "Monthly financial review", exact: true })
      .locator("tbody tr td"),
  ).toHaveText(["-2.00", "No mapped types", "-2.00", "-2.00"]);
  await expect(page.getByRole("region", { name: "2026 review totals", exact: true })).toContainText(
    "Source total gap",
  );
  await page.getByRole("button", { name: "Type family breakdown", exact: true }).click();
  const unmatched = page.getByRole("table", { name: "Yearly unpaired activity", exact: true });
  await expect(unmatched.locator("tbody tr")).toHaveCount(1);
  await expect(unmatched.locator("td[data-column=finances_amount]")).toHaveText("-2.00");
  await expect(unmatched.locator("td[data-column=data_kiosk_amount]")).toHaveText("No mapped type");
  await expect(unmatched.getByRole("columnheader", { name: /Difference|Source gap/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("table", { name: "Yearly paired type families", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("figure", { name: "Monthly and running source gaps", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry family chart", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(
    drawer
      .getByRole("table", { name: "Financial review totals", exact: true })
      .locator("tbody tr td"),
  ).toHaveText(["-2.00", "No mapped types", "-2.00"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    drawer.getByRole("region", { name: "Financial review totals", exact: true }),
  ).toBeVisible();
  await expect(drawer.locator(".monthly-review-totals-mobile dd")).toHaveText([
    "-2.00",
    "No mapped types",
    "-2.00",
  ]);
  const monthlyAvailability = drawer.getByRole("note", {
    name: "Source availability",
    exact: true,
  });
  await expect(monthlyAvailability).toContainText(
    "No Data Kiosk types are mapped for the selected families.",
  );
  await expect(monthlyAvailability).not.toContainText(
    /shown as zero|coverage is incomplete|No Data Kiosk records/,
  );
  await drawer.getByRole("button", { name: "Type family comparison", exact: true }).click();
  await expect(
    drawer.getByRole("table", { name: "Monthly unpaired activity", exact: true }),
  ).toContainText("No mapped type");
  await drawer.getByRole("button", { name: "Source records", exact: true }).click();
  const records = drawer.getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(records).toContainText("EPR fees");
  await expect(records).toContainText("-2.00");
  await expectAccessible("unpaired-family-retains-records");
});
