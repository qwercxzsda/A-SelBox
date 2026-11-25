import { expect, test } from "@playwright/test";
import { financesRow } from "./api-fixtures.mjs";
import { openSourceLookup } from "./financial-source-fixtures.mjs";
import {
  monthsTable,
  reviewDrawer,
  reviewMeasure,
  reviewOutcome,
} from "./financial-review-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  adInvoiceRow,
  agedStorageRow,
  openRawData,
  removalOrderRow,
  storageRow,
} from "./raw-data-fixtures.mjs";
import {
  VIEWPORTS,
  clickAt,
  expectStays,
  holdRows,
  placeAt,
  viewportName,
} from "./scroll-stability-actions.mjs";

// Switching a Raw data source, changing the Financial review scope and paging a list inside a
// drawer keep the control just used under the pointer. Only the pager below a list moves to the
// list's start.
const ROWS = Array.from({ length: 100 }, (_, index) => index);
const SOURCES = [
  "Advertising invoice",
  "Monthly storage report",
  "Aged storage report",
  "Removal order report",
];

/** January 2025 has 120 "No assignment" records (three pages) and one "Rounding errors". */
function reviewYear(fixture) {
  const outcomes = [];
  const months = [];
  // Amounts in ten-thousandths keep the month totals exact.
  const amount = (tenThousandths) => (tenThousandths / 10_000).toFixed(4);
  for (const [month, missing, rounding] of [
    ["2025-01", 120, 1],
    ["2025-02", 2, 0],
  ]) {
    const [missingBase, missingTax, roundingBase] = [
      -20_000 * missing,
      -2000 * missing,
      -2 * rounding,
    ];
    months.push(
      reviewMeasure(month, "COMPANY", "-100", "-10", null, 10),
      reviewMeasure(
        month,
        "DIFFERENCE",
        amount(missingBase),
        amount(missingTax),
        "NO_ASSIGNMENT",
        missing,
      ),
      reviewMeasure(
        month,
        "FINANCES",
        amount(-1_000_000 + missingBase + roundingBase),
        amount(-100_000 + missingTax),
        null,
        10 + missing + rounding,
      ),
    );
    if (rounding)
      months.push(
        reviewMeasure(month, "DIFFERENCE", amount(roundingBase), "0", "ROUNDING", rounding),
      );
    for (let index = 0; index < missing + rounding; index += 1)
      outcomes.push(
        reviewOutcome(outcomes.length + 1, {
          posted_date: `${month}-${String((index % 28) + 1).padStart(2, "0")}`,
          ...(index < missing
            ? {}
            : { reason: "ROUNDING", base_amount: "-0.0002", tax_amount: "0", sku: null }),
        }),
      );
  }
  fixture.reviewMonths = months;
  fixture.reviewOutcomes = outcomes;
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewportName(viewport)}`, () => {
    test.describe.configure({ timeout: 120_000 });
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
    });

    test("opening a Raw data source keeps the source tabs in place", async ({ page }) => {
      const fixture = await mockSupabase(page);
      fixture.roles["member-a"] = "administrator";
      fixture.financesRows = ROWS.map((index) => financesRow(index + 1));
      fixture.rawRows = {
        ad_invoices: ROWS.map((index) =>
          adInvoiceRow(index + 1, { invoice_date: `2026-0${String((index % 9) + 1)}-01` }),
        ),
        storage: ROWS.map((index) => storageRow(index)),
        aged_storage: ROWS.map((index) => agedStorageRow(index)),
        removal_orders: [removalOrderRow(1)],
      };
      const held = await holdRows(page, "ad_invoices", "storage", "aged_storage", "removal_orders");
      await signIn(page);
      await openRawData(page, "Finances");
      const table = page.getByRole("table", { name: "Financial records", exact: true });
      await page.getByLabel("Rows", { exact: true }).selectOption("100");
      await expect(table.locator("tbody tr")).toHaveCount(100);
      const sources = page.getByRole("tablist", { name: "Raw data sources", exact: true });
      // First visits load while the panel keeps its place; revisits come from the cache.
      for (const [label, first] of [
        ...SOURCES.map((source) => [source, true]),
        ["Finances", false],
        ["Advertising invoice", false],
      ]) {
        const tab = sources.getByRole("tab", { name: label, exact: true });
        await tab.evaluate((element) => {
          element.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
        });
        await placeAt(page, sources, 20);
        await expectStays(page, [sources, tab], {
          action: () => clickAt(page, tab),
          held: first ? held : null,
          settled: () => expect(table.locator("tbody tr").first()).toBeVisible(),
        });
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }
      await page.getByRole("tab", { name: "Removal order report", exact: true }).click();
      await expect(page.locator(".pagination-summary")).toHaveText("1 removal order line");
    });

    test("Financial review keeps its scope selectors in place", async ({ page }) => {
      const fixture = await mockSupabase(page);
      fixture.roles["member-a"] = "administrator";
      reviewYear(fixture);
      const held = await holdRows(page, "reviewMonths");
      await signIn(page);
      await page.getByRole("tab", { name: "Financial review", exact: true }).click();
      const scope = page.getByRole("group", { name: "Financial review scope", exact: true });
      const year = scope.getByLabel("Year", { exact: true });
      const marketplace = scope.getByLabel("Marketplace", { exact: true });
      const months = monthsTable(page).locator("tbody tr");
      await year.selectOption("2025");
      await expect(months).toHaveCount(2);
      const empty = () => expect(page.getByText("No activity in", { exact: false })).toBeVisible();
      for (const [y, select, value, settled] of [
        [20, year, "2024", empty],
        [20, year, "2025", () => expect(months).toHaveCount(2)],
        [0.3, marketplace, "Amazon.de", empty],
        [0.3, marketplace, "Amazon.com", () => expect(months).toHaveCount(2)],
      ]) {
        await placeAt(page, scope, y);
        await expectStays(page, [scope, select], {
          action: () => select.selectOption(value),
          held: settled === empty ? held : null,
          settled,
        });
      }
    });

    test("the month drawer's record pager above the rows pages in place", async ({ page }) => {
      const fixture = await mockSupabase(page);
      fixture.roles["member-a"] = "administrator";
      reviewYear(fixture);
      const held = await holdRows(page, "reviewRecords");
      await signIn(page);
      await page.getByRole("tab", { name: "Financial review", exact: true }).click();
      await page.getByLabel("Year", { exact: true }).selectOption("2025");
      await monthsTable(page)
        .getByRole("row", { name: /^January 2025/ })
        .click();
      const drawer = reviewDrawer(page, "January 2025");
      const records = drawer.getByRole("table", { name: "Difference records", exact: true });
      await expect(records.locator("tbody tr")).toHaveCount(50);
      const pager = drawer.getByRole("navigation", {
        name: "Pagination for difference records",
        exact: true,
      });
      const step = (name) => pager.getByRole("button", { name, exact: true });
      const page2 = () => expect(pager).toContainText("Page 2 · 121 records");

      // At rest where the drawer opened, then lower in the drawer.
      await expectStays(page, [pager, step("Next difference records")], {
        action: () => clickAt(page, step("Next difference records")),
        held,
        settled: page2,
      });
      await placeAt(page, pager, 0.4);
      await expectStays(page, [pager, step("Next difference records")], {
        action: () => clickAt(page, step("Next difference records")),
        held,
        settled: () => expect(records.locator("tbody tr")).toHaveCount(21),
      });
      await expectStays(page, [pager, step("Previous difference records")], {
        action: () => clickAt(page, step("Previous difference records")),
        held,
        settled: page2,
      });
      await expect(drawer.getByRole("group", { name: "difference records" })).toBeFocused();

      // The pager below the rows goes back to the list's start.
      const bottom = drawer.getByRole("navigation", {
        name: "Pagination for difference records at bottom",
        exact: true,
      });
      await placeAt(page, bottom, 0.5);
      await clickAt(page, bottom.getByRole("button", { name: /^Previous/ }));
      await expect(pager).toContainText("Page 1 · 121 records");
      await expect(pager).toBeInViewport({ ratio: 1 });

      // Selecting a reason with fewer records keeps the reason table and the clicked row.
      const reasons = drawer.getByRole("table", { name: "Differences by reason", exact: true });
      const rounding = reasons.getByRole("row", { name: /^Rounding errors/ }).locator("th, td");
      await placeAt(page, reasons, 120);
      await expectStays(page, [reasons, rounding.first()], {
        action: () => clickAt(page, rounding.first()),
        held,
        settled: () => expect(records.locator("tbody tr")).toHaveCount(1),
      });
      await expect(pager.getByText("Page 1 · 1 record", { exact: true })).toBeVisible();

      // Removing the reason chip keeps the reason table where it is.
      await placeAt(page, reasons, 120);
      const chip = drawer.getByRole("button", { name: "Remove Reason: Rounding errors" });
      await expectStays(page, [reasons], {
        action: () => clickAt(page, chip),
        held,
        settled: () => expect(records.locator("tbody tr")).toHaveCount(50),
      });
    });

    test("Find transaction's pager above the matches pages in place", async ({ page }) => {
      const { lookup, table } = await openSourceLookup(page, { count: 60 });
      const pager = lookup.getByRole("navigation", { name: "Pagination for matches", exact: true });
      const step = (name) => pager.getByRole("button", { name, exact: true });
      const results = lookup.getByRole("region", { name: "Amazon transaction results" });
      for (const [name, shown] of [
        ["Next matches", "Page 2"],
        ["Next matches", "Page 3"],
        ["Previous matches", "Page 2"],
      ]) {
        await expectStays(page, [pager, step(name)], {
          action: () => clickAt(page, step(name)),
          settled: () => expect(pager).toContainText(shown),
        });
        await expect(results).toBeFocused();
      }
      await expect(table.locator("tbody tr")).toHaveCount(25);
      const bottom = lookup.getByRole("navigation", { name: "Pagination for matches at bottom" });
      await placeAt(page, bottom, 0.5);
      await clickAt(page, bottom.getByRole("button", { name: /^Previous/ }));
      await expect(pager).toContainText("Page 1");
      await expect(pager).toBeInViewport({ ratio: 1 });
    });
  });
}
