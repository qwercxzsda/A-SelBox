import { expect, test } from "@playwright/test";
import marketplaces from "../../src/generated/marketplaces.json" with { type: "json" };
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyDates, applySummaryDates, columnTrigger } from "./table-actions.mjs";
import {
  summaryAmount,
  summaryBucket,
  summaryPeriods,
  summaryRegion,
  summaryTable,
} from "./summary-fixtures.mjs";

const PERIODS = ["Last day", "Last month", "Selected dates"];
const SEP_ORDER = [
  "Amazon.se",
  "Amazon.sg", // Selected + month + day; alphabetic, not amount or count.
  "Amazon.nl", // Selected + month.
  "Amazon.it", // Selected + day.
  "Amazon.es",
  "Amazon.fr", // Selected only; alphabetic despite different amounts/currencies.
  "Amazon.de", // Month + day.
  "Amazon.ca",
  "Amazon.co.jp", // Month only; the zero amount in Canada still has a transaction.
  "Amazon.com", // Day only.
];
const MONTH_ORDER = [
  "Amazon.de",
  "Amazon.se",
  "Amazon.sg",
  "Amazon.ca",
  "Amazon.co.jp",
  "Amazon.nl",
  "Amazon.com",
  "Amazon.it",
];

function allMarketsAfter(active) {
  return [...active, ...marketplaces.filter((marketplace) => !active.includes(marketplace)).sort()];
}

async function fixtureWithPresencePatterns(page) {
  const fixture = await mockSupabase(page);
  const patterns = [
    ["Amazon.se", [1, 1, 1], "-1", 1],
    ["Amazon.sg", [1, 1, 1], "999999999.99", 9000],
    ["Amazon.nl", [1, 1, 0], "-900000", 1],
    ["Amazon.it", [1, 0, 1], "-800000", 1],
    ["Amazon.es", [1, 0, 0], "9000000000", 50000],
    ["Amazon.fr", [1, 0, 0], "1000000", 7000],
    ["Amazon.de", [0, 1, 1], "6000000", 500],
    ["Amazon.ca", [0, 1, 0], "0", 1],
    ["Amazon.co.jp", [0, 1, 0], "5000000", 100],
    ["Amazon.com", [0, 0, 1], "4000000", 100],
    ["Amazon.ae", [0, 0, 0], "3000000", 100],
  ];
  const dates = ["2026-09-15", "2026-10-15", "2026-11-06"];
  fixture.aggregateRows = patterns.flatMap(([marketplace, presence, amount, rowCount]) =>
    presence.flatMap((hasTransactions, index) =>
      hasTransactions ? [summaryBucket(dates[index], amount, { marketplace, rowCount })] : [],
    ),
  );
  // A current-day transaction anchors Last day to the preceding date.
  fixture.aggregateRows.push(summaryBucket("2026-11-07", "0", { marketplace: "Amazon.sg" }));
  // Multiple currencies are still one marketplace for ordering and row alignment.
  fixture.aggregateRows.push(
    summaryBucket("2026-09-15", "-99999999999999", {
      marketplace: "Amazon.fr",
      currency: "EUR",
      rowCount: 40000,
    }),
  );
  await signIn(page);
  await expect(summaryRegion(page)).toHaveAttribute("aria-busy", "false");
  return fixture;
}

async function expectSharedOrder(page, expected) {
  await expect(summaryRegion(page)).toHaveAttribute("aria-busy", "false");
  for (const title of PERIODS) {
    await expect
      .poll(() =>
        summaryTable(page, title)
          .locator("tbody[data-marketplace]")
          .evaluateAll((elements) => elements.map((element) => element.dataset.marketplace)),
      )
      .toEqual(expected);
  }
}

async function expectAlignedRows(page) {
  const layouts = await Promise.all(
    PERIODS.map((title) =>
      summaryTable(page, title)
        .locator("tbody[data-marketplace]")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { marketplace: element.dataset.marketplace, top: box.top, height: box.height };
          }),
        ),
    ),
  );
  for (const layout of layouts.slice(1)) {
    for (let index = 0; index < layout.length; index++) {
      expect(layout[index].marketplace).toBe(layouts[0][index].marketplace);
      expect(Math.abs(layout[index].top - layouts[0][index].top)).toBeLessThan(1);
      expect(Math.abs(layout[index].height - layouts[0][index].height)).toBeLessThan(1);
    }
  }
}

for (const width of [390, 1440]) {
  test(`marketplaces sort by selected, monthly and daily presence with alphabetical ties at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixtureWithPresencePatterns(page);
    await applySummaryDates(page, "2026-09-01", "2026-09-30");
    await expect(
      page.getByRole("dialog", { name: "Choose summary dates", exact: true }),
    ).toBeHidden();
    await expectSharedOrder(page, allMarketsAfter(SEP_ORDER));

    const canada = summaryPeriods(page, "Amazon.ca");
    await expect(summaryAmount(canada.month, "Reported amount")).toHaveText("0.00 USD");
    await expect(canada.month.locator("[data-record-count]")).toHaveAttribute(
      "data-record-count",
      "1",
    );
    await expect(
      summaryPeriods(page, "Amazon.fr").selected.locator("tr[data-currency]"),
    ).toHaveCount(2);
    for (const title of PERIODS) {
      await expect(
        summaryTable(page, title).locator('tbody[data-marketplace="Amazon.ae"]'),
      ).toContainText("No transactions");
    }
    if (width >= 1200) await expectAlignedRows(page);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await summaryRegion(page).screenshot({
      path: testInfo.outputPath(`presence-order-${width}.png`),
      animations: "disabled",
    });
  });
}

test("changing or clearing selected dates recomputes the shared order and filters retain sorted subsets", async ({
  page,
}) => {
  const fixture = await fixtureWithPresencePatterns(page);
  await expectSharedOrder(page, allMarketsAfter(MONTH_ORDER));
  await applySummaryDates(page, "2026-09-01", "2026-09-30");
  await expectSharedOrder(page, allMarketsAfter(SEP_ORDER));
  await applyDates(page, "2026-10-01", "2026-10-31");
  await expectSharedOrder(page, allMarketsAfter(MONTH_ORDER));
  await applySummaryDates(page, "", "");
  await expectSharedOrder(page, allMarketsAfter(MONTH_ORDER));
  await expect(summaryTable(page, "Selected dates").locator("[data-amount-field]")).toHaveCount(0);

  await applySummaryDates(page, "2026-09-01", "2026-09-30");
  await columnTrigger(page, "Marketplace").click();
  const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
  for (const market of ["Amazon.fr", "Amazon.ae", "Amazon.com", "Amazon.co.jp", "Amazon.sg"])
    await menu.getByRole("checkbox", { name: market, exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expectSharedOrder(page, [
    "Amazon.sg",
    "Amazon.fr",
    "Amazon.co.jp",
    "Amazon.com",
    "Amazon.ae",
  ]);
  await expectAlignedRows(page);
  expect(fixture.latestRequests).toHaveLength(1);
  await page.reload();
  await expectSharedOrder(page, [
    "Amazon.sg",
    "Amazon.fr",
    "Amazon.co.jp",
    "Amazon.com",
    "Amazon.ae",
  ]);
});
