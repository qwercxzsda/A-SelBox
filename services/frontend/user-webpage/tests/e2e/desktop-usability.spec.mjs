import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { liveRow } from "./api-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { summaryBucket } from "./summary-fixtures.mjs";

for (const width of [1440, 1920, 834, 390]) {
  test(`workspace navigation stays stable and preserves financial context at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "operator";
    fixture.liveRows = Array.from({ length: 40 }, (_, index) => ({
      ...liveRow("DESKTOP", index),
      activity_date: "2026-07-31",
    }));
    fixture.aggregateRows = [
      summaryBucket("2026-07-31", "100", { rowCount: 40 }),
      summaryBucket("2026-07-31", "90", { rowCount: 40, currency: "EUR" }),
      summaryBucket("2026-06-30", "200"),
      summaryBucket("2026-06-30", "180", { currency: "EUR" }),
    ];
    await mockInventory(page, [inventoryRow("DESKTOP-0", { available: "0" })]);
    await signIn(page);
    const tabs = page.getByRole("tablist", { name: "Workspace data" });
    const summaries = page.getByRole("region", { name: "Estimated totals", exact: true });
    const currency = summaries.getByLabel("Currency", { exact: true });
    await expect(currency).toBeVisible();
    await currency.selectOption("EUR");
    await expect(summaries).toContainText("90 EUR");
    await expect(page.getByRole("tabpanel", { name: "Transactions", exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(25);
    const navBounds = await tabs.boundingBox();
    const summaryBounds = await summaries.boundingBox();
    expect(navBounds.y + navBounds.height).toBeLessThan(summaryBounds.y);
    if (width >= 1440) {
      expect((await table.boundingBox()).y).toBeLessThan(650);
      const visibleRows = await table
        .locator("tbody tr")
        .evaluateAll(
          (rows) =>
            rows.filter((row) => row.getBoundingClientRect().bottom <= globalThis.innerHeight)
              .length,
        );
      expect(visibleRows).toBeGreaterThanOrEqual(7);
      if (width === 1920) {
        expect((await page.locator(".app-frame").boundingBox()).width).toBeGreaterThan(1700);
      }
    }
    const pagination = page.getByRole("navigation", { name: "Pagination", exact: true });
    await expect(pagination.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await pagination.getByRole("button", { name: "Next", exact: true }).click();
    await expect(pagination.getByRole("textbox", { name: "Page number" })).toHaveValue("2");

    for (const name of ["Settlements", "Data Kiosk", "Current fees", "User access", "Inventory"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(summaries).toHaveCount(0);
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      expect((await tabs.boundingBox()).y).toBeCloseTo(navBounds.y, 0);
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1,
        ),
      ).toBe(false);
      if (name === "User access") {
        await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveCount(0);
      }
    }
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await expect(currency).toHaveValue("EUR");
    await page.getByRole("tab", { name: "Transactions", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tabpanel", { name: "Settlements", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tabpanel", { name: "Transactions", exact: true })).toBeVisible();
    await expect(currency).toHaveValue("EUR");
    await expect(pagination.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    await expect(table.locator("tbody tr")).toHaveCount(15);
    const date = page.getByRole("button", { name: "Date", exact: true });
    await date.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Date options", exact: true });
    await expect(menu).toHaveCSS("opacity", "1");
    const fromDate = menu.getByLabel("From date", { exact: true });
    await fromDate.focus();
    await expect(fromDate).toBeFocused();
    await fromDate.press("Escape");
    await expect(menu).toBeHidden();
    await expect(date).toBeFocused();
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: false,
      animations: "disabled",
    });
  });
}
