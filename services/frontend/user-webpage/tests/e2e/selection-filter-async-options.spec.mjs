import { expect, test } from "@playwright/test";
import { deferred } from "./fixtures.mjs";
import { openFinancialReview } from "./financial-review-actions.mjs";
import { setupFamilies } from "./financial-review-family-fixtures.mjs";
import { familyMenu, familyTrigger } from "./financial-review-family-actions.mjs";

for (const interaction of ["none", "next control", "return to Close"]) {
  test(`delayed filter search preserves ${interaction === "none" ? "initial search intent" : interaction}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const options = deferred();
    await openFinancialReview(page, (fixture) => {
      setupFamilies(fixture, { extraFamilies: 5 });
      fixture.beforeFinancialReview = ({ endpoint }) =>
        endpoint === "financial_review_type_totals" ? options.promise : undefined;
    });
    try {
      await familyTrigger(page).press("Enter");
      const menu = familyMenu(page);
      const close = menu.getByRole("button", { name: "Close options", exact: true });
      const done = menu.getByRole("button", { name: "Done", exact: true });
      await expect(menu.getByText("No options available.", { exact: true })).toBeVisible();
      await expect(close).toBeFocused();
      if (interaction !== "none") {
        await close.press("Tab");
        await expect(done).toBeFocused();
        if (interaction === "return to Close") {
          await done.press("Shift+Tab");
          await expect(close).toBeFocused();
        }
      }
      options.resolve();
      const search = menu.getByRole("textbox", { name: "Search type families", exact: true });
      await expect(search).toBeVisible();
      await expect(menu.getByRole("checkbox")).toHaveCount(10);
      await expect(
        interaction === "none" ? search : interaction === "next control" ? done : close,
      ).toBeFocused();
      await menu.press("Escape");
      await expect(familyTrigger(page)).toBeFocused();
    } finally {
      options.resolve();
    }
  });
}
