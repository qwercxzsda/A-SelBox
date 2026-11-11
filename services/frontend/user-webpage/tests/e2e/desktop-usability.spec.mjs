import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { liveRow } from "./api-fixtures.mjs";
import { inventoryRow, mockInventory } from "./inventory-fixtures.mjs";
import { summaryBucket } from "./summary-fixtures.mjs";
import { columnTrigger, openColumn } from "./table-actions.mjs";
import marketplaces from "../../src/generated/marketplaces.json" with { type: "json" };

for (const width of [1440, 1920, 834, 390]) {
  test(`workspace navigation stays stable and preserves financial context at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.liveRows = Array.from({ length: 40 }, (_, index) => ({
      ...liveRow("DESKTOP", index),
      activity_date: "2026-07-31",
    }));
    fixture.aggregateRows = [
      // The latest posting starts the next UTC day; the cards retain July's data.
      summaryBucket("2026-08-01", "0"),
      summaryBucket("2026-07-31", "100", { rowCount: 40 }),
      summaryBucket("2026-07-31", "90", { rowCount: 40, currency: "EUR" }),
      summaryBucket("2026-06-30", "200"),
      summaryBucket("2026-06-30", "180", { currency: "EUR" }),
    ];
    await mockInventory(page, [inventoryRow("DESKTOP-0", { available: "0" })]);
    await signIn(page);
    const tabs = page.getByRole("tablist", { name: "Workspace data" });
    const summaries = page.getByRole("region", { name: "Current totals", exact: true });
    await expect(summaries.getByRole("combobox")).toHaveCount(0);
    await expect(summaries.getByRole("radiogroup")).toHaveCount(0);
    const dayTotals = summaries.getByRole("table", {
      name: "Last day marketplace totals",
      exact: true,
    });
    const monthTotals = summaries.getByRole("table", {
      name: "Last month marketplace totals",
      exact: true,
    });
    await expect(
      dayTotals.getByRole("row", { name: "Amazon.com EUR totals", exact: true }),
    ).toContainText("90.00");
    await expect(page.getByRole("tabpanel", { name: "Transactions", exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(table.locator("tbody tr")).toHaveCount(25);
    const navBounds = await tabs.boundingBox();
    await expect(summaries).toHaveAttribute("aria-busy", "false");
    const overview = summaries.getByRole("table", {
      name: "Last day marketplace totals",
      exact: true,
    });
    await expect(overview.locator("tbody[data-marketplace]")).toHaveCount(marketplaces.length);
    const cards = ["Last day", "Last month", "Selected dates"].map((title) =>
      summaries.getByRole("article", { name: `${title} totals`, exact: true }),
    );
    const allMarketBounds = [];
    for (const card of cards) {
      await expect(card).toBeVisible();
      allMarketBounds.push(await card.boundingBox());
      const heading = card.locator(".totals-card-heading");
      const geometry = await heading.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const title = element.querySelector(".totals-card-label").getBoundingClientRect();
        const control = element.querySelector(".totals-date-control").getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return {
          height: box.height,
          titleRight: title.right,
          controlLeft: control.left,
          controlRight: control.right,
          rightInset: box.right - Number.parseFloat(style.paddingRight),
          controlTop: control.top,
          topInset: box.top + Number.parseFloat(style.paddingTop),
        };
      });
      expect(geometry.controlRight).toBeCloseTo(geometry.rightInset, 0);
      expect(geometry.controlLeft).toBeGreaterThanOrEqual(geometry.titleRight + 5);
      expect(geometry.controlTop).toBeGreaterThanOrEqual(geometry.topInset - 1);
      expect(geometry.controlTop).toBeLessThanOrEqual(geometry.topInset + 2);
      expect(geometry.height).toBeLessThanOrEqual(74);
      expect(
        await card.evaluate((element) =>
          [...element.querySelectorAll("*")].some(
            (child) =>
              ["auto", "scroll"].includes(globalThis.getComputedStyle(child).overflowY) &&
              child.scrollHeight > child.clientHeight + 1,
          ),
        ),
      ).toBe(false);
    }
    await expect(dayTotals.getByRole("button", { name: /^Filter transactions to / })).toHaveCount(
      0,
    );
    await expect(
      cards[0].getByRole("button", {
        name: "Filter transactions to Jul 31, 2026 · UTC",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      cards[1].getByRole("button", { name: "Filter transactions to July 2026 · UTC", exact: true }),
    ).toHaveCount(1);
    const summaryBounds = await summaries.boundingBox();
    if (width >= 1200) {
      expect(allMarketBounds[1].y).toBeCloseTo(allMarketBounds[0].y, 0);
      expect(allMarketBounds[2].y).toBeCloseTo(allMarketBounds[0].y, 0);
    } else {
      expect(allMarketBounds[1].y).toBeGreaterThan(allMarketBounds[0].y);
      expect(allMarketBounds[2].y).toBeGreaterThan(allMarketBounds[1].y);
    }
    const marketplaceMenu = await openColumn(page, "Marketplace");
    await marketplaceMenu.getByRole("checkbox", { name: "Amazon.com", exact: true }).check();
    await marketplaceMenu.getByRole("checkbox", { name: "Amazon.co.jp", exact: true }).check();
    await marketplaceMenu.getByRole("button", { name: "Close options", exact: true }).click();
    for (let index = 0; index < cards.length; index++) {
      await expect(cards[index].locator("tbody[data-marketplace]")).toHaveCount(2);
      expect((await cards[index].boundingBox()).height).toBeLessThan(
        allMarketBounds[index].height - 100,
      );
    }
    const resetMenu = await openColumn(page, "Marketplace");
    await resetMenu.getByRole("button", { name: "Clear marketplace", exact: true }).click();
    await resetMenu.getByRole("button", { name: "Close options", exact: true }).click();
    for (const card of cards)
      await expect(card.locator("tbody[data-marketplace]")).toHaveCount(marketplaces.length);
    expect(navBounds.y + navBounds.height).toBeLessThan(summaryBounds.y);
    if (width >= 1440) {
      // Growing totals cards use page scrolling; record paging remains independent.
      await table.evaluate((element) => element.scrollIntoView({ block: "start" }));
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

    for (const name of [
      "Finances",
      "Data Kiosk",
      "Current fees",
      "User access",
      "Companies",
      "Inventory",
    ]) {
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
        await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeVisible();
      }
    }
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    await expect(monthTotals).toBeVisible();
    await expect(
      dayTotals.getByRole("row", { name: "Amazon.com EUR totals", exact: true }),
    ).toContainText("90.00");
    await expect(
      dayTotals.getByRole("row", { name: "Amazon.com USD totals", exact: true }),
    ).toContainText("100.00");
    await page.getByRole("tab", { name: "Transactions", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tabpanel", { name: "Finances", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tabpanel", { name: "Transactions", exact: true })).toBeVisible();
    await expect(
      dayTotals.getByRole("row", { name: "Amazon.com EUR totals", exact: true }),
    ).toContainText("90.00");
    await expect(
      dayTotals.getByRole("row", { name: "Amazon.com USD totals", exact: true }),
    ).toContainText("100.00");
    await expect(pagination.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    await expect(table.locator("tbody tr")).toHaveCount(15);
    const date = columnTrigger(page, "Date (UTC)");
    await date.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Date (UTC) options", exact: true });
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
