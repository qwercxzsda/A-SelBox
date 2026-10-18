import { expect } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { setupFinancialReview } from "./financial-review-fixtures.mjs";

export async function openFinancialReview(page, configure = () => {}) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  configure(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  return fixture;
}

export async function checkFinancialReviewUpdates(page, fixture) {
  const completed = () => fixture.revisionRequests.filter(({ completed }) => completed).length;
  const before = completed();
  await page.clock.fastForward(60_000);
  await expect.poll(completed).toBeGreaterThan(before);
  await expect(page.getByText("Updating…", { exact: true })).toBeHidden();
}
