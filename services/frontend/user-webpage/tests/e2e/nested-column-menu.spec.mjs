import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

for (const focusTarget of ["checkbox", "close", "search"]) {
  test(`Escape from a nested column ${focusTarget} closes only its popover`, async ({ page }) => {
    await openFinancialReview(page, (fixture) => {
      if (focusTarget === "search") {
        for (let index = 1; index <= 10; index++) {
          fixture.companyNames[`0198b50b-701a-7000-8001-${String(index).padStart(12, "0")}`] =
            `Filter company ${index}`;
        }
      }
    });
    await page.getByRole("button", { name: "Open review for June 2026", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    await drawer.getByRole("button", { name: "Saved report snapshots", exact: true }).click();
    const trigger = drawer.getByRole("button", { name: "Company", exact: true });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Company options", exact: true });
    const focus =
      focusTarget === "checkbox"
        ? menu.getByRole("checkbox").first()
        : focusTarget === "search"
          ? menu.getByLabel("Search company", { exact: true })
          : menu.getByRole("button", { name: "Close options", exact: true });
    await focus.focus();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
}
