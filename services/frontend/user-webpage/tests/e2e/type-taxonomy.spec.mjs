import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyDates, openColumn } from "./table-actions.mjs";
import { summaryAmount, summaryBucket, summaryPeriods, typeBucket } from "./summary-fixtures.mjs";
import { setupFinancialReview } from "./financial-review-fixtures.mjs";
import { familyMenu, familyTrigger } from "./financial-review-family-actions.mjs";

const BROAD_GROUPS = [
  "Sales & refunds",
  "Selling fees",
  "Fulfillment & shipping",
  "Storage & inventory",
  "Advertising & promotions",
  "Taxes",
  "Other fees & adjustments",
  "Seller-provided costs",
];
const ADVERTISING_TYPES = [
  "COUPON_PARTICIPATION_FEE",
  "COUPON_PERFORMANCE_FEE",
  "DEAL_PARTICIPATION_FEE",
  "DEAL_PERFORMANCE_FEE",
  "RUN_LIGHTNING_DEAL_FEE",
  "SPONSORED_PRODUCT_FEE",
  "SPONSORED_PRODUCTS",
  "SPONSORED_PRODUCTS_CHARGE",
  "SPONSORED_PRODUCTS_CHARGES",
  "SPONSORED_BRANDS",
  "SPONSORED_BRANDS_CHARGE",
  "SPONSORED_BRANDS_CHARGES",
  "SPONSORED_DISPLAY",
  "SPONSORED_DISPLAY_CHARGE",
  "SPONSORED_DISPLAY_CHARGES",
  "POINTS",
  "PROMOTIONAL_REBATES",
  "PROMOTIONAL_REFUNDS",
].sort();
const ADVERTISING_ROWS = [
  ["SPONSORED_PRODUCTS_CHARGE", "Sponsored products", "-10"],
  ["SPONSORED_BRANDS_CHARGE", "Sponsored brands", "-20"],
  ["SPONSORED_DISPLAY_CHARGE", "Sponsored display", "-30"],
  ["COUPON_PARTICIPATION_FEE", "Coupon fees", "-4"],
  ["DEAL_PERFORMANCE_FEE", "Deal fees", "-6"],
];

test("one broad advertising selection filters exact types and totals while review retains detailed families", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  fixture.liveRows = [
    ...ADVERTISING_ROWS.map(([component_type, , amount], index) => ({
      ...liveRow("AD", index + 1),
      source: "DATA_KIOSK",
      category: "DATA_KIOSK",
      activity_date: "2026-07-14",
      activity_at: "2026-07-15T06:59:59.999999Z",
      component_type,
      source_amount: amount,
      fee_amount: "0",
      company_amount: amount,
    })),
    {
      ...liveRow("SALES", 1),
      component_type: "PRODUCT_SALES",
      activity_date: "2026-07-15",
      activity_at: "2026-07-15T12:00:00.000000Z",
      source_amount: "100",
      fee_amount: "0",
      company_amount: "100",
    },
  ];
  fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
  fixture.aggregateRows = [
    ...fixture.liveRows.map((row) => ({
      ...summaryBucket(row.activity_date, row.source_amount),
      activity_at: row.activity_at,
      source: row.source,
      sku: row.sku,
      component_type: row.component_type,
    })),
    summaryBucket("2026-08-01", "0"),
  ];
  fixture.breakdownRows = fixture.liveRows.map((row) => ({
    ...typeBucket(row.component_type, row.source_amount),
    source: row.source,
    sku: row.sku,
  }));
  const reviewScope = {
    month: "2026-07-01",
    category: "DATA_KIOSK",
    marketplace_name: "Amazon.com",
    currency: "USD",
  };
  fixture.financialReviewTotals = [
    {
      ...reviewScope,
      finances_amount: "-24",
      data_kiosk_amount: "-70",
      difference: "46",
      finances_row_count: "3",
      data_kiosk_row_count: "5",
    },
  ];
  fixture.financialReviewTypeTotals = [
    ...ADVERTISING_ROWS.map(([component_type, , amount]) => ({
      source: "DATA_KIOSK",
      component_type,
      amount,
    })),
    { source: "FINANCES", component_type: "ADVERTISING", amount: "-12" },
    { source: "FINANCES", component_type: "COUPON_FEES", amount: "-5" },
    { source: "FINANCES", component_type: "DEAL_FEES", amount: "-7" },
  ].map((row) => ({ ...reviewScope, ...row, row_count: "1" }));
  fixture.financialReviewRecords = [];
  await signIn(page);
  await applyDates(page, "2026-07-01", "2026-07-31");
  await expect(summaryAmount(summaryPeriods(page).selected, "Reported amount")).toHaveText(
    "30.00 USD",
  );
  const menu = await openColumn(page, "Type");
  await expect(menu.getByLabel("Search type", { exact: true })).toHaveAttribute(
    "placeholder",
    "Groups or individual types",
  );
  const visibleGroups = await menu
    .locator(".type-filter-group")
    .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label")));
  expect(visibleGroups).toEqual(BROAD_GROUPS.filter((group) => group !== "Seller-provided costs"));
  await menu.getByRole("checkbox", { name: "Advertising & promotions group", exact: true }).check();
  await menu.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(() => fixture.requests.at(-1).args.p_types.slice().sort())
    .toEqual(ADVERTISING_TYPES);
  await expect(summaryAmount(summaryPeriods(page).selected, "Reported amount")).toHaveText(
    "-70.00 USD",
  );
  const records = page.getByRole("table", { name: "Financial records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(5);
  await expect(records.locator(".transaction-type-group")).toHaveText(
    Array(5).fill("Advertising & promotions"),
  );
  await page
    .getByRole("button", { name: /^View Selected dates for Amazon.com in USD by type:/ })
    .click();
  const totals = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  const group = totals.getByRole("button", {
    name: "Advertising & promotions details",
    exact: true,
  });
  await expect(totals.getByRole("button", { name: / details$/ })).toHaveCount(1);
  await expect(
    group.locator('[data-amount="reportedAmount"] .type-breakdown-group-value'),
  ).toHaveText("-70.00 USD");
  expect(fixture.breakdownRequests.at(-1).args.p_types.slice().sort()).toEqual(ADVERTISING_TYPES);
  await group.click();
  await expect(totals.getByRole("row", { name: / amounts$/ })).toHaveCount(5);
  await totals
    .getByRole("button", { name: "View Advertising & promotions records", exact: true })
    .click();
  await expect(
    totals.getByRole("table", { name: "Amount records", exact: true }).locator("tbody tr"),
  ).toHaveCount(5);
  await totals.getByRole("button", { name: "Close breakdown", exact: true }).click();

  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await familyTrigger(page).click();
  await expect(familyMenu(page).getByRole("checkbox")).toHaveCount(5);
  for (const [, family] of ADVERTISING_ROWS)
    await expect(
      familyMenu(page).getByRole("checkbox", { name: family, exact: true }),
    ).toBeVisible();
  await expect(
    familyMenu(page).getByRole("checkbox", { name: "Advertising & promotions", exact: true }),
  ).toHaveCount(0);
  await familyMenu(page).getByRole("checkbox", { name: "Sponsored brands", exact: true }).check();
  await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "2026 review totals", exact: true })
      .locator(".financial-review-summary-value"),
  ).toHaveText(["No mapped types", "-20.00 USD", "20.00 USD"]);
  await page.getByRole("button", { name: "Type family breakdown", exact: true }).click();
  const detailed = page.getByRole("region", { name: "Yearly type family breakdown", exact: true });
  await expect(detailed.locator("tbody tr")).toHaveCount(1);
  await expect(detailed).toContainText("Sponsored brands");
  await expect(detailed).not.toContainText("Sponsored products");
});
