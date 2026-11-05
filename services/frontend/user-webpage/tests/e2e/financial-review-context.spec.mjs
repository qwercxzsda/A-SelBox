import { expect, test } from "@playwright/test";
import { openFinancialReview } from "./financial-review-actions.mjs";

for (const width of [1440, 390]) {
  test(`financial review keeps month, marketplace, currency and category in its header at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await openFinancialReview(page);
    await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    await expect(drawer.getByRole("note")).toContainText("Totals use original precision");
    const context = drawer.locator(".detail-drawer-context");
    await expect(context).toHaveText(
      "July 2026 · Amazon.com · USD · Data Kiosk category · All companies",
    );
    await drawer
      .getByRole("button", { name: "Saved report snapshots", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(context).toBeInViewport();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`review-context-${width}.png`),
      animations: "disabled",
    });
  });
}
