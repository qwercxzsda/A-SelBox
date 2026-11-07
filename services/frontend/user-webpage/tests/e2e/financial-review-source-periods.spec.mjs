import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { reviewAmounts } from "./financial-review-fixtures.mjs";
import { chooseFamilies } from "./financial-review-family-actions.mjs";

const table = (page) => page.getByRole("table", { name: "Monthly financial review", exact: true });
const drawer = (page) =>
  page.getByRole("dialog", { name: "Monthly financial review", exact: true });
const totals = (page) => page.getByRole("region", { name: "2026 review totals", exact: true });
const currency = (page) => page.getByRole("combobox", { name: "Currency", exact: true });
const year = (page) => page.getByRole("combobox", { name: "Year", exact: true });

test("recent partial months enter totals, currencies, families and records independently of payout eligibility", async ({
  page,
}) => {
  const policyRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/payout_report_policy"))
      policyRequests.push(request);
  });
  const fixture = await openFinancialReview(page, (state) => {
    state.payoutPolicyStatus = 503;
    state.currentSourceCoverage = ["FINANCES", "DATA_KIOSK"].map((source) => ({
      source,
      seller_namespace: "seller-one",
      start_date: "2026-06-01",
      end_date: "2026-07-20",
    }));
  });
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
    "July 2026",
  ]);
  await expect(currency(page).locator("option")).toHaveText(["EUR", "USD"]);
  await expect(totals(page)).toContainText("-200.50 USD");
  await expect(totals(page)).toContainText("-214.25 USD");
  await expect(totals(page)).toContainText("13.75 USD");
  await expect(totals(page)).toContainText("Source retrieval coverage is incomplete");
  await expect(table(page).getByRole("cell").last()).toHaveText("13.75");
  await expect(page.locator(".financial-review-scope-note")).toContainText(
    "Source records through July 2026",
  );
  await table(page).getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  await expect(drawer(page)).toContainText("Retrieval coverage may be incomplete");
  await expect(
    drawer(page).getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
  await drawer(page).getByRole("button", { name: "Source records", exact: true }).click();
  await expect(
    drawer(page).getByRole("table", { name: "Source records", exact: true }).locator("tbody tr"),
  ).toHaveCount(50);
  await drawer(page)
    .getByRole("button", { name: "Close monthly financial review", exact: true })
    .click();
  await chooseFamilies(page, ["Monthly storage"]);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "June 2026",
    "July 2026",
  ]);
  await expect(totals(page)).toContainText("13.75 USD");
  await expect(totals(page)).toContainText("Source retrieval coverage is incomplete");
  expect(
    fixture.financialReviewRequests
      .filter(({ endpoint }) => endpoint === "current_source_totals")
      .some(({ params }) => params.get("p_end") === "2026-12-31"),
  ).toBe(true);
  expect(
    fixture.financialReviewRequests
      .filter(({ endpoint }) => endpoint === "financial_review_type_totals")
      .some(({ params }) => params.get("p_month_to") === "2027-01-01"),
  ).toBe(true);
  expect(policyRequests).toHaveLength(0);
});

test("reload restores a recent month even when payout policy is unavailable", async ({ page }) => {
  const fixture = await openFinancialReview(page);
  await table(page).getByRole("button", { name: "Open review for July 2026", exact: true }).click();
  fixture.payoutPolicyStatus = 503;
  await page.reload();
  await expect(drawer(page).getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
  await expect(
    drawer(page).getByRole("table", { name: "Amounts by type", exact: true }).locator("tbody tr"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Retry available months", exact: true }),
  ).toHaveCount(0);
});

test("a recent January supplies the latest available year and currency", async ({ page }) => {
  await openFinancialReview(page, (state) => {
    state.payoutPolicyStatus = 503;
    state.financialReviewTotals = [
      { month: "2025-12-01", currency: "USD", ...reviewAmounts() },
      { month: "2026-01-01", currency: "JPY", ...reviewAmounts() },
    ];
  });
  await expect(year(page)).toHaveValue("2026");
  await expect(year(page).locator("option")).toHaveText(["2026", "2025"]);
  await expect(page.getByLabel("Amount currency: JPY", { exact: true })).toBeVisible();
  await expect(currency(page)).toHaveCount(0);
  await expect(table(page).getByRole("button", { name: /^Open review for/ })).toHaveText([
    "January 2026",
  ]);
});
