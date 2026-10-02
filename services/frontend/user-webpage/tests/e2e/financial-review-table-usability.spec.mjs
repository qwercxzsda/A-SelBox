import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { setupFinancialReview } from "./financial-review-fixtures.mjs";

for (const width of [1440, 390]) {
  test(`review type amounts align with totals and retain a visible, accessible selection at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    setupFinancialReview(fixture);
    await signIn(page);
    await page.getByRole("tab", { name: "Financial review", exact: true }).click();
    await page.getByRole("button", { name: "Open review for July 2026", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Monthly financial review", exact: true });
    await drawer.getByLabel("Review currency", { exact: true }).selectOption("USD");
    const table = drawer.getByRole("table", { name: "Amounts by type", exact: true });
    const scroll = drawer.getByRole("region", { name: "Amounts by type table", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(2);
    for (const header of ["Amount (USD)", "Records"])
      await expect(table.getByRole("columnheader", { name: header, exact: true })).toHaveCSS(
        "text-align",
        "right",
      );
    for (const value of ["-100.25", "-101.5", "25", "26"])
      await expect(table.getByRole("cell", { name: value, exact: true })).toHaveCSS(
        "text-align",
        "right",
      );
    const storage = table.getByRole("row").filter({
      has: page.getByRole("cell", { name: "FBA storage fee", exact: true }),
    });
    await expect(storage).toHaveAttribute("aria-selected", "false");
    await scroll.scrollIntoViewIfNeeded();
    await scroll.focus();
    await expect(scroll).toBeFocused();
    if (width === 390) {
      expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    const viewRecords = storage.getByRole("button", {
      name: "View records for Data Kiosk · FBA storage fee",
      exact: true,
    });
    await viewRecords.focus();
    await page.keyboard.press("Enter");
    await expect(drawer.getByRole("table", { name: "Source records", exact: true })).toBeVisible();
    await expect(storage).toHaveAttribute("aria-selected", "true");
    await expect(table.locator("tbody tr[aria-selected='true']")).toHaveCount(1);
    await scroll.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const selectedColor = await storage.evaluate(
      (element) => globalThis.getComputedStyle(element).backgroundColor,
    );
    const unselectedColor = await table
      .locator("tbody tr[aria-selected='false']")
      .evaluate((element) => globalThis.getComputedStyle(element).backgroundColor);
    expect(selectedColor).not.toBe(unselectedColor);
    const request = fixture.financialReviewRequests
      .filter(({ endpoint }) => endpoint === "financial_review_records")
      .at(-1);
    expect(request.params.get("source")).toBe("eq.DATA_KIOSK");
    expect(request.params.get("component_type")).toBe("eq.FBA_STORAGE_FEE");
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`review-type-selection-${width}.png`),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "Clear selected type", exact: true }).click();
    await expect(table.locator("tbody tr[aria-selected='true']")).toHaveCount(0);
  });
}
