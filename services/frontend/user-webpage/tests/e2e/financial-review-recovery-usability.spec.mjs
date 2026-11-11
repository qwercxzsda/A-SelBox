import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

test("failed review period checks stop describing the scope as loading", async ({ page }) => {
  await openFinancialReview(page, (state) => {
    state.financialReviewStatusForRequest = ({ params }) =>
      params.get("select") === "activity_date" ? 403 : 200;
  });
  await expect(page.getByRole("alert")).toContainText("Could not load available review periods.");
  await expect(page.getByText("Checking available source months…", { exact: true })).toHaveCount(0);
});

for (const periods of [true, false]) {
  test(`retrying ${periods ? "available review periods" : "monthly summaries"} retains keyboard context`, async ({
    page,
  }) => {
    const fixture = await openFinancialReview(page, (state) => {
      if (periods)
        state.financialReviewStatusForRequest = ({ params }) =>
          params.get("select") === "activity_date" ? 403 : 200;
      else
        state.financialReviewStatusForRequest = ({ params }) =>
          params.get("limit") === "1" ? 200 : 403;
    });
    const retry = page.getByRole("button", {
      name: periods ? "Retry available months" : "Retry monthly summaries",
      exact: true,
    });
    await expect(retry).toBeVisible();
    fixture.financialReviewStatusForRequest = null;
    await retry.focus();
    await retry.press("Enter");
    await expect(
      page.getByRole("button", { name: "Open review for July 2026", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".financial-review-months")).toBeFocused();
    await expect(page.locator(".financial-review-summary-period")).toContainText("July 2026");
  });
}
