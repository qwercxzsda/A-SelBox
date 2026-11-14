import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { chooseFamilies, clearFamilies } from "./financial-review-family-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";

test("monthly totals and family comparison reuse complete raw types without mixing selected families or currencies", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, setupFamilies);
  const monthly = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  const totals = monthly.getByRole("table", { name: "Financial review totals", exact: true });
  const comparison = monthly.getByRole("table", { name: "Type family comparison", exact: true });
  const completeReads = (currency) =>
    fixture.financialReviewRequests.filter(
      ({ endpoint, params, completed }) =>
        completed &&
        endpoint === "financial_review_type_totals" &&
        params.get("p_month_from") === "2026-01-01" &&
        params.get("p_month_to") === "2026-02-01" &&
        params.get("p_currency") === currency &&
        params.get("limit") === "1000",
    );
  async function openJanuary() {
    await page.getByRole("button", { name: "Open review for January 2026", exact: true }).click();
    await expect(totals.locator("tbody tr")).toHaveCount(1);
  }
  async function closeMonth() {
    await monthly
      .getByRole("button", { name: "Close monthly financial review", exact: true })
      .click();
    await expect(monthly).toBeHidden();
  }

  await chooseFamilies(page, ["Monthly storage fees", "Sponsored products"]);
  await openJanuary();
  await expect(totals.getByRole("cell")).toHaveText(["-40.01", "-33.00", "-7.01"]);
  await expect.poll(() => completeReads("USD").length).toBe(1);
  await monthly.getByRole("button", { name: "Type family comparison", exact: true }).click();
  await expect(comparison.locator("tbody tr")).toHaveCount(2);
  expect(completeReads("USD")).toHaveLength(1);

  await closeMonth();
  await clearFamilies(page);
  await chooseFamilies(page, ["Aged inventory surcharges"]);
  await openJanuary();
  await expect(totals.getByRole("cell")).toHaveText(["-20.00", "-18.00", "-2.00"]);
  await expect(comparison.locator("tbody tr")).toHaveCount(1);
  await expect(comparison).toContainText("Aged inventory surcharges");
  expect(completeReads("USD")).toHaveLength(1);

  await closeMonth();
  await clearFamilies(page);
  await chooseFamilies(page, ["Monthly storage fees"]);
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("EUR");
  await openJanuary();
  await expect(totals.getByRole("cell")).toHaveText(["-30.00", "-25.00", "-5.00"]);
  await expect.poll(() => completeReads("EUR").length).toBe(1);
  expect(completeReads("USD")).toHaveLength(1);
});
