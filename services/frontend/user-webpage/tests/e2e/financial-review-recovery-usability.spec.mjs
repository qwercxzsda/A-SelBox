import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

test("failed review period checks stop describing the scope as loading", async ({ page }) => {
  await openFinancialReview(page, (state) => {
    state.payoutPolicyStatus = 403;
  });
  await expect(page.getByRole("alert")).toContainText("Could not load available review periods.");
  await expect(page.locator(".financial-review-scope-note")).not.toContainText(
    "Checking mature months…",
  );
});

for (const periods of [true, false]) {
  test(`retrying ${periods ? "available review periods" : "monthly summaries"} retains keyboard context`, async ({
    page,
  }) => {
    const fixture = await openFinancialReview(page, (state) => {
      if (periods) state.payoutPolicyStatus = 403;
      else
        state.financialReviewStatusForRequest = ({ params }) =>
          params.get("limit") === "1" ? 200 : 403;
    });
    const retry = page.getByRole("button", {
      name: periods ? "Retry available months" : "Retry monthly summaries",
      exact: true,
    });
    await expect(retry).toBeVisible();
    fixture.payoutPolicyStatus = 200;
    fixture.financialReviewStatusForRequest = null;
    await retry.focus();
    await retry.press("Enter");
    await expect(
      page.getByRole("button", { name: "Open review for July 2026", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".financial-review-months")).toBeFocused();
    await expect(page.locator(".financial-review-scope-note")).toContainText(
      "Full mature months through July 2026",
    );
  });
}
