import { mockSupabase, signIn } from "./fixtures.mjs";
import { expect } from "@playwright/test";

export const readiness = (page) =>
  page.getByRole("region", { name: "April 2026 payout readiness", exact: true });

export async function openReviewReadiness(page, configure) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  configure(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByLabel("Month", { exact: true }).fill("2026-04");
  await expect(readiness(page)).toBeVisible();
  return fixture;
}
