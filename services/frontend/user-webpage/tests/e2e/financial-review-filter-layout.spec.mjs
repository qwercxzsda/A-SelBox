import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import { familyMenu, familyTrigger } from "./financial-review-family-actions.mjs";

async function paintedBounds(locator) {
  return locator.evaluate(
    (element) =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => {
          globalThis.requestAnimationFrame(() => {
            const { x, y, width, height } = element.getBoundingClientRect();
            resolve({ x, y, width, height });
          });
        });
      }),
  );
}

for (const width of [1440, 390]) {
  test(`fee-family controls stay fixed while loading and recovering at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let releaseTotals;
    let releaseFamilies;
    let holdTotals = true;
    let holdFamilies = true;
    const fixture = await openFinancialReview(page, (state) => {
      setupFamilies(state);
      // Start with one currency; the other year introduces a genuine currency chooser.
      state.financialReviewTotals = state.financialReviewTotals.filter(
        (row) => row.currency === "USD" || row.month.startsWith("2025-"),
      );
      state.financialReviewTypeTotals = state.financialReviewTypeTotals.filter(
        (row) => row.currency === "USD" || row.month.startsWith("2025-"),
      );
      state.beforeFinancialReview = ({ endpoint }) => {
        if (endpoint === "current_source_totals" && holdTotals)
          return new Promise((resolve) => {
            releaseTotals = () => {
              holdTotals = false;
              resolve();
            };
          });
        if (endpoint === "financial_review_type_totals" && holdFamilies)
          return new Promise((resolve) => {
            releaseFamilies = () => {
              holdFamilies = false;
              resolve();
            };
          });
      };
    });
    const trigger = familyTrigger(page);
    const year = page.getByRole("combobox", { name: "Year", exact: true });
    const retry = page.getByRole("button", { name: "Retry fee families", exact: true });
    const header = page.locator(".workspace-header");
    const loading = header.getByText("Loading…", { exact: true });
    await expect(year).toHaveValue("2026");
    await expect.poll(() => typeof releaseTotals).toBe("function");
    await expect(loading).toBeVisible();
    await expect(page.getByText("Loading monthly summaries…", { exact: true })).toHaveCount(0);
    const before = await paintedBounds(trigger);
    async function expectStable() {
      const current = await paintedBounds(trigger);
      for (const key of ["x", "y", "width", "height"])
        expect(Math.abs(current[key] - before[key]), `${key} changed`).toBeLessThan(1);
      await expect(trigger).toBeEnabled();
    }

    releaseTotals();
    await expect.poll(() => typeof releaseFamilies).toBe("function");
    await expect(loading).toBeVisible();
    await expect(page.getByText("Loading fee families…", { exact: true })).toHaveCount(0);
    await expectStable();
    await expect(page.getByLabel("Amount currency: USD", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toHaveCount(0);
    releaseFamilies();
    await expect(loading).toBeHidden();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(
      familyMenu(page).getByRole("checkbox", { name: "Monthly storage", exact: true }),
    ).toBeVisible();
    await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
    await expectStable();

    // A new year produces a fresh request, then an error and an explicit retry.
    holdFamilies = true;
    releaseFamilies = undefined;
    fixture.financialReviewStatusForRequest = ({ endpoint }) =>
      endpoint === "financial_review_type_totals" ? 503 : 200;
    await year.selectOption("2025");
    await expect.poll(() => typeof releaseFamilies).toBe("function");
    await expect(
      page.getByRole("combobox", { name: "Currency", exact: true }).locator("option"),
    ).toHaveText(["EUR", "USD"]);
    await expectStable();
    releaseFamilies();
    await expect(retry).toBeVisible();
    await expect(loading).toBeHidden();
    await expect(header.getByText("Updating…", { exact: true })).toBeHidden();
    await expectStable();

    holdFamilies = true;
    releaseFamilies = undefined;
    fixture.financialReviewStatusForRequest = null;
    await retry.press("Enter");
    await expect.poll(() => typeof releaseFamilies).toBe("function");
    await expectStable();
    await expect(trigger).toBeFocused();
    releaseFamilies();
    await expect(retry).toBeHidden();
    await expectStable();
    await trigger.click();
    await expect(
      familyMenu(page).getByRole("checkbox", { name: "Monthly storage", exact: true }),
    ).toBeVisible();
    await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
      ),
    ).toBe(true);
  });
}
