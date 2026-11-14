import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { setupFinancialReview } from "./financial-review-fixtures.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import { familyTrigger, familyMenu } from "./financial-review-family-actions.mjs";

const summary = (page) => page.getByRole("region", { name: "2026 review totals", exact: true });
const warning = (page) =>
  page.getByRole("alert").filter({ hasText: "Unavailable type family selections" });
const selectedIds = (page) => new URL(page.url()).searchParams.getAll("family");

async function openLink(page, families) {
  const fixture = await mockSupabase(page);
  setupFinancialReview(fixture);
  setupFamilies(fixture);
  const params = new URLSearchParams({
    tab: "financial-review",
    category: "DATA_KIOSK",
    year: "2026",
    reviewMarketplace: "Amazon.com",
    currency: "USD",
    month: "2026-01",
  });
  for (const id of families) params.append("family", id);
  await page.goto(`/?${params}`);
  await signIn(page);
  return fixture;
}

for (const families of [["refund-commission"], ["monthly-storage", "refund-commission"]]) {
  test(`unavailable family selections stay blocked until explicitly removed: ${families.join(", ")}`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await openLink(page, families);
    await expect(warning(page)).toBeVisible({ timeout: 15_000 });
    await expect(summary(page)).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Monthly financial review", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Type family breakdown", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual(families);
    await familyTrigger(page).click();
    await expect(
      familyMenu(page).getByRole("checkbox", {
        name: "Unavailable: refund-commission",
        exact: true,
      }),
    ).toBeChecked();
    await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    await expect(warning(page)).toBeVisible();
    await expect.poll(() => selectedIds(page)).toEqual(families);
    expect(
      fixture.financialReviewRequests.filter(({ endpoint }) =>
        ["current_source_totals", "financial_review_type_totals"].includes(endpoint),
      ),
    ).toEqual([]);

    await warning(page)
      .getByRole("button", { name: "Remove unavailable families", exact: true })
      .click();
    await expect(warning(page)).toHaveCount(0);
    await expect(summary(page)).toBeVisible();
    const remaining = families.filter((id) => id !== "refund-commission");
    await expect.poll(() => selectedIds(page)).toEqual(remaining);
    if (remaining.length)
      await expect(summary(page).locator(".financial-review-summary-value")).toHaveText([
        "-14.01 USD",
        "-9.00 USD",
        "-5.01 USD",
      ]);
    await page.reload();
    await expect(summary(page)).toBeVisible();
    await expect.poll(() => selectedIds(page)).toEqual(remaining);
    expect(errors).toEqual([]);
  });
}

test("a source-qualified unknown type remains a valid selected family", async ({ page }) => {
  const id = "source:FINANCES:FUTURE_FEE";
  await openLink(page, [id]);
  await expect(summary(page)).toBeVisible({ timeout: 15_000 });
  await expect(warning(page)).toHaveCount(0);
  await expect(summary(page).locator(".financial-review-summary-value")).toHaveText([
    "-11.00 USD",
    "No mapped types",
    "-11.00 USD",
  ]);
  await expect.poll(() => selectedIds(page)).toEqual([id]);
});
