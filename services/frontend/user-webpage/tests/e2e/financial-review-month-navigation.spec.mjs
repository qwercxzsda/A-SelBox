import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

for (const width of [390, 1280]) {
  test(`month navigation keeps its keyboard position at available-month boundaries at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openFinancialReview(page);
    const july = page.getByRole("button", {
      name: "View chart details for July 2026",
      exact: true,
    });
    await july.click();
    const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    const navigation = drawer.getByRole("navigation", {
      name: "Review months in this year",
      exact: true,
    });
    const previous = navigation.getByRole("button", { name: "Previous", exact: true });
    const next = navigation.getByRole("button", { name: "Next", exact: true });
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect(drawer.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();
    await expect(previous).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`review-month-boundary-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Enter");
    await expect(drawer.getByRole("heading", { name: "June 2026", exact: true })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(drawer.getByRole("heading", { name: "July 2026", exact: true })).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(next).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(previous).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(july).toBeFocused();
  });
}
