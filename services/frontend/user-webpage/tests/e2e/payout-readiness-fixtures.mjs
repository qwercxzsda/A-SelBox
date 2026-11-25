import { expect } from "@playwright/test";
import {
  monthsTable,
  openFinancialReview,
  reviewDrawer,
  reviewMeasure,
} from "./financial-review-fixtures.mjs";

export const readiness = (page) =>
  page.getByRole("region", { name: "April 2026 payout readiness", exact: true });

/** Readiness is a section of a Financial review month, collapsed until opened. */
export async function openReviewReadiness(page, configure) {
  const fixture = await openFinancialReview(page, {
    year: "2026",
    configure(state) {
      state.reviewMonths = [
        reviewMeasure("2026-04", "FINANCES", "-10", "-1", null, 2),
        reviewMeasure("2026-04", "COMPANY", "-10", "-1", null, 2),
      ];
      configure(state);
    },
  });
  await monthsTable(page)
    .getByRole("row", { name: /^April 2026/ })
    .click();
  await reviewDrawer(page, "April 2026")
    .getByRole("button", { name: "Payout readiness", exact: true })
    .click();
  await expect(readiness(page)).toBeVisible();
  return fixture;
}
