import { expect } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

export const readiness = (page) =>
  page.getByRole("region", { name: "April 2026 payout readiness", exact: true });

export async function openReviewReadiness(page, configure) {
  const fixture = await openFinancialReview(page, (state) => {
    for (const field of ["financialReviewTotals", "financialReviewTypeTotals"])
      state[field] = state[field]
        .filter((row) => row.month === "2026-06-01")
        .map((row) => ({ ...row, month: "2026-04-01" }));
    state.financialReviewRecords = state.financialReviewRecords
      .filter((row) => row.activity_date.startsWith("2026-06"))
      .map((row) => ({ ...row, activity_date: row.activity_date.replace("2026-06", "2026-04") }));
    configure(state);
  });
  await page.getByRole("button", { name: "Open review for April 2026", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
  await drawer.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
  await expect(readiness(page)).toBeVisible();
  return fixture;
}
