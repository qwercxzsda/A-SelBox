import { expect, test } from "@playwright/test";
import { openFinancialReview, checkFinancialReviewUpdates } from "./financial-review-actions.mjs";
import { reviewAmounts } from "./financial-review-fixtures.mjs";

const table = (page) => page.getByRole("table", { name: "Monthly financial review", exact: true });
const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const totals = (page) => page.getByRole("region", { name: "2026 review totals", exact: true });
const currency = (page) => page.getByRole("combobox", { name: "Currency", exact: true });
const year = (page) => page.getByRole("combobox", { name: "Year", exact: true });

function setPolicy(fixture, cutoff, latestMonth) {
  fixture.payoutPolicy = {
    mature_cutoff_date: cutoff,
    latest_month: latestMonth,
    mature_cutoff_months: 2,
  };
}

function useThreeJulyRecords(fixture) {
  const isJulyUsd = (row) =>
    row.currency === "USD" &&
    row.category === "DATA_KIOSK" &&
    (row.month ?? row.activity_date).startsWith("2026-07");
  const july = fixture.financialReviewTotals.find(isJulyUsd);
  july.finances_row_count = "2";
  july.data_kiosk_row_count = "1";
  const finances = fixture.financialReviewRecords.find(
    (row) => isJulyUsd(row) && row.source === "FINANCES",
  );
  const kiosk = fixture.financialReviewRecords.find(
    (row) => isJulyUsd(row) && row.source === "DATA_KIOSK",
  );
  fixture.financialReviewRecords = [
    ...fixture.financialReviewRecords.filter((row) => !isJulyUsd(row)),
    { ...finances, activity_date: "2026-07-01", amount: "-90.25" },
    { ...finances, source_row_id: "july-last-day", activity_date: "2026-07-31", amount: "-10" },
    { ...kiosk, activity_date: "2026-07-31", amount: "-101.5" },
  ];
  for (const row of fixture.financialReviewTypeTotals.filter(isJulyUsd))
    row.row_count = row.source === "FINANCES" ? "2" : "1";
}

test("partial months stay out of totals, running sums, currencies and details until the whole month matures", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openFinancialReview(page, (state) => {
    setPolicy(state, "2026-07-27", "2026-06-01");
    useThreeJulyRecords(state);
  });
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
  ]);
  await expect(currency(page).locator("option")).toHaveText(["USD"]);
  await expect(totals(page)).toContainText("-100.25 USD");
  await expect(totals(page)).toContainText("-112.75 USD");
  await expect(totals(page)).toContainText("12.50 USD");
  await expect(table(page).getByRole("cell").last()).toHaveText("12.50");
  await expect(page.getByText(/Full mature months through June 2026/)).toBeVisible();
  await expect(page.getByText("Mature dates only", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("figure", { name: "Monthly and running differences", exact: true })
      .getByRole("button", { name: /: View chart details for / }),
  ).toHaveCount(1);
  await table(page).getByRole("button", { name: "Open review for June 2026", exact: true }).click();
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  await expect(
    drawer(page).getByRole("table", { name: "Source records", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
  await drawer(page)
    .getByRole("button", { name: "Close monthly financial review", exact: true })
    .click();

  setPolicy(fixture, "2026-07-31", "2026-06-01");
  await checkFinancialReviewUpdates(page, fixture);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
  ]);
  await expect(currency(page).locator("option")).toHaveText(["USD"]);
  await expect(totals(page)).toContainText("12.50 USD");

  setPolicy(fixture, "2026-08-01", "2026-07-01");
  await checkFinancialReviewUpdates(page, fixture);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
    "July 2026",
  ]);
  await expect(currency(page).locator("option")).toHaveText(["EUR", "USD"]);
  await expect(totals(page)).toContainText("-200.50 USD");
  await expect(totals(page)).toContainText("-214.25 USD");
  await expect(totals(page)).toContainText("13.75 USD");
  await expect(table(page).getByRole("cell").last()).toHaveText("13.75");
  await table(page).getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  await expect(drawer(page)).toContainText("Full mature months through July 2026");
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  const records = drawer(page).getByRole("table", { name: "Source records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(3);
  await expect(records.getByRole("cell", { name: "-10.00", exact: true })).toBeVisible();
  const request = fixture.financialReviewRequests
    .filter(
      ({ endpoint, params }) =>
        endpoint === "financial_review_records" && params.get("select") !== "activity_date",
    )
    .at(-1);
  expect(request.params.get("and")).toBe(
    "(activity_date.gte.2026-07-01,activity_date.lte.2026-07-31)",
  );
});

test("F5 keeps a stale partial-month selection closed without reading its details", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await table(page).getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  await expect(
    drawer(page).getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
  // Simulate a saved selection from the former partial-month view becoming ineligible.
  setPolicy(fixture, "2026-07-27", "2026-06-01");
  const before = fixture.financialReviewRequests.length;
  await page.reload();
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
  ]);
  await expect(drawer(page)).toHaveCount(0);
  await expect(year(page)).toHaveValue("2026");
  await expect(currency(page)).toHaveValue("USD");
  const detailReads = fixture.financialReviewRequests
    .slice(before)
    .filter(({ endpoint, params }) =>
      endpoint === "financial_review_totals" || endpoint === "financial_review_type_totals"
        ? params.get("p_month_from") !== "2026-01-01"
        : endpoint !== "financial_review_records" || params.get("select") !== "activity_date",
    );
  expect(detailReads.map(({ endpoint, params }) => `${endpoint}?${params}`)).toEqual([]);
});

test("a partially mature January does not create a new year or currency choice", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openFinancialReview(page, (state) => {
    setPolicy(state, "2026-01-18", "2025-12-01");
    state.financialReviewTotals = [
      { month: "2025-12-01", currency: "USD", ...reviewAmounts() },
      { month: "2026-01-01", currency: "JPY", ...reviewAmounts() },
    ];
  });
  await expect(year(page)).toHaveValue("2025");
  await expect(year(page).locator("option")).toHaveText(["2025"]);
  await expect(currency(page).locator("option")).toHaveText(["USD"]);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "December 2025",
  ]);
  setPolicy(fixture, "2026-02-01", "2026-01-01");
  await checkFinancialReviewUpdates(page, fixture);
  await expect(year(page)).toHaveValue("2026");
  await expect(year(page).locator("option")).toHaveText(["2026", "2025"]);
  await currency(page).selectOption("JPY");
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "January 2026",
  ]);
});
