import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { reviewAmounts, setupManyFinancialReviewRows } from "./financial-review-fixtures.mjs";

const year = (page) => page.getByRole("combobox", { name: "Year", exact: true });
const currency = (page) => page.getByRole("combobox", { name: "Currency", exact: true });
const table = (page) => page.getByRole("table", { name: "Monthly financial review", exact: true });
const category = (page, name) =>
  page
    .getByRole("tablist", { name: "Financial review", exact: true })
    .getByRole("tab", { name, exact: true });
const row = (page, month) =>
  table(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("button", { name: `Open review for ${month}`, exact: true }),
    });

test("a full year shows at most twelve chronological months in one currency without overview pagination", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupManyFinancialReviewRows);
  await expect(year(page)).toHaveValue("2026");
  await expect(currency(page)).toHaveValue("USD");
  await expect(table(page).locator("tbody tr")).toHaveCount(7);
  await expect(page.getByRole("combobox", { name: "Rows", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: /^Monthly summaries pagination/ })).toHaveCount(
    0,
  );
  await expect(table(page).getByRole("button", { name: "Month", exact: true })).toHaveCount(0);
  await year(page).selectOption("2025");
  await expect(table(page).locator("tbody tr")).toHaveCount(12);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "January 2025",
    "February 2025",
    "March 2025",
    "April 2025",
    "May 2025",
    "June 2025",
    "July 2025",
    "August 2025",
    "September 2025",
    "October 2025",
    "November 2025",
    "December 2025",
  ]);
  await expect(table(page)).not.toContainText("EUR");
  await expect(table(page)).not.toContainText("JPY");
  const reads = fixture.financialReviewRequests.filter(
    ({ endpoint }) => endpoint === "current_source_totals",
  );
  expect(
    reads.some(
      ({ params }) =>
        params.get("p_start") === "2025-01-01" && params.get("p_end") === "2025-12-31",
    ),
  ).toBe(true);
  for (const { params } of reads) {
    expect(params.get("p_start")).toMatch(/^\d{4}-01-01$/);
    expect(params.get("p_end")).toBe(
      params.get("p_start").startsWith("2026") ? "2026-12-31" : "2025-12-31",
    );
    expect(params.has("p_currency")).toBe(false);
  }
  const anchors = fixture.financialReviewRequests.filter(
    ({ params }) => params.get("select") === "activity_date",
  );
  expect(new Set(anchors.map(({ params }) => params.get("order")))).toEqual(
    new Set(["activity_date.asc", "activity_date.desc"]),
  );
});

test("running differences sum exact monthly values before display rounding and never mix currencies", async ({
  page,
}) => {
  await openFinancialReview(page, (fixture) => {
    fixture.financialReviewTotals = [
      {
        month: "2026-01-01",
        currency: "USD",
        ...reviewAmounts({
          finances_amount: "9007199254740993.004",
          data_kiosk_amount: "0",
          difference: "9007199254740993.004",
        }),
      },
      {
        month: "2026-02-01",
        currency: "USD",
        ...reviewAmounts({
          finances_amount: "-9007199254740993.001",
          data_kiosk_amount: "0",
          difference: "-9007199254740993.001",
        }),
      },
      {
        month: "2026-03-01",
        currency: "USD",
        ...reviewAmounts({ finances_amount: "0.004", data_kiosk_amount: "0", difference: "0.004" }),
      },
      {
        month: "2026-01-01",
        currency: "EUR",
        ...reviewAmounts({ finances_amount: "1000", data_kiosk_amount: "0", difference: "1000" }),
      },
      {
        month: "2026-02-01",
        currency: "EUR",
        ...reviewAmounts({ finances_amount: "-1000", data_kiosk_amount: "0", difference: "-1000" }),
      },
    ];
  });
  await expect(table(page).getByRole("columnheader", { name: /Running difference/ })).toBeVisible();
  await expect(row(page, "January 2026").getByRole("cell").last()).toHaveText(
    "9,007,199,254,740,993.00",
  );
  await expect(row(page, "February 2026").getByRole("cell").last()).toHaveText("0.00");
  await expect(row(page, "March 2026").getByRole("cell").last()).toHaveText("0.01");
  await currency(page).selectOption("EUR");
  await expect(table(page).locator("tbody tr")).toHaveCount(2);
  await expect(row(page, "January 2026").getByRole("cell").last()).toHaveText("1,000.00");
  await expect(row(page, "February 2026").getByRole("cell").last()).toHaveText("0.00");
  await expect(table(page)).not.toContainText("9,007,199");
});

test("year and currency stay shared across categories and reloads, including unavailable currency and gap years", async ({
  page,
}) => {
  await openFinancialReview(page, setupManyFinancialReviewRows);
  await currency(page).selectOption("EUR");
  await year(page).selectOption("2025");
  await expect(table(page).locator("tbody tr")).toHaveCount(12);
  await category(page, "SelBox").click();
  await expect(year(page)).toHaveValue("2025");
  await expect(table(page)).toContainText("No source records for Amazon.com in EUR in 2025.");
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  await page.reload();
  await expect(category(page, "SelBox")).toHaveAttribute("aria-selected", "true");
  await expect(year(page)).toHaveValue("2025");
  await expect(table(page)).toContainText("No source records for Amazon.com in EUR in 2025.");
  await category(page, "Data Kiosk").click();
  await expect(table(page).locator("tbody tr")).toHaveCount(12);
  await year(page).selectOption("2024");
  await expect(table(page)).toContainText("No source records for Amazon.com in EUR in 2024.");
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  await year(page).selectOption("2020");
  await expect(currency(page)).toHaveValue("EUR");
  await expect(currency(page).locator("option")).toContainText(["EUR", "USD"]);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveCount(0);
  await currency(page).selectOption("USD");
  await expect(row(page, "January 2020")).toBeVisible();
  await expect(row(page, "January 2020").getByRole("cell").last()).toHaveText("1.25");
});

test("a marketplace with only yen derives its unit and keeps zero differences visible", async ({
  page,
}) => {
  await openFinancialReview(page, (fixture) => {
    fixture.financialReviewTotals = [
      {
        month: "2025-12-01",
        currency: "JPY",
        ...reviewAmounts({ finances_amount: "-100", data_kiosk_amount: "-100", difference: "0" }),
      },
    ];
  });
  await expect(year(page)).toHaveValue("2025");
  await expect(page.getByRole("region", { name: "2025 review totals", exact: true })).toContainText(
    "JPY",
  );
  await expect(currency(page)).toHaveCount(0);
  await expect(row(page, "December 2025")).toContainText("-100.00");
  await expect(row(page, "December 2025").getByRole("cell").last()).toHaveText("0.00");
  await page.reload();
  await expect(year(page)).toHaveValue("2025");
  await expect(page.getByRole("region", { name: "2025 review totals", exact: true })).toContainText(
    "JPY",
  );
  await expect(row(page, "December 2025")).toBeVisible();
});

test("chart keyboard selection opens the same currency and restores focus to its month", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  await currency(page).selectOption("EUR");
  const chart = page.getByRole("figure", { name: "Monthly and running differences", exact: true });
  const july = chart.getByRole("button", {
    name: "Jul: View chart details for July 2026",
    exact: true,
  });
  await expect(july).toHaveAttribute(
    "title",
    /^July 2026: Monthly difference 0\.00 EUR; Running difference 0\.00 EUR(?:\n|$)/,
  );
  await july.focus();
  await july.press("Enter");
  const detail = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await expect(detail.getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  const totals = detail.getByRole("table", { name: "Financial review totals", exact: true });
  await expect(totals.locator("tbody tr")).toHaveCount(1);
  await expect(totals.getByRole("cell", { name: "-10.00", exact: true })).toHaveCount(2);
  expect(
    fixture.financialReviewRequests
      .filter(({ endpoint }) => endpoint === "current_source_totals")
      .at(-1)
      .params.get("p_currency"),
  ).toBe("EUR");
  await detail.getByRole("button", { name: "Close monthly financial review", exact: true }).click();
  await expect(july).toBeFocused();
});
