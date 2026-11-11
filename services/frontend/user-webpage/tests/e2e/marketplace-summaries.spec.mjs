import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  summaryAmount,
  summaryCard,
  summaryBucket,
  summaryPeriods,
  summaryTable,
  typeBucket,
} from "./summary-fixtures.mjs";
import marketplaces from "../../src/generated/marketplaces.json" with { type: "json" };
import { applyDates, columnTrigger } from "./table-actions.mjs";

for (const width of [390, 1440]) {
  test(`all currencies stay separated by marketplace with scoped breakdowns at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.aggregatePageCap = 1;
    fixture.aggregateRows = [
      summaryBucket("2026-11-05", "100"),
      summaryBucket("2026-11-05", "20", { currency: "EUR" }),
      summaryBucket("2026-11-06", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
      summaryBucket("2026-11-05", "7", { marketplace: "Non-Amazon US" }),
    ];
    fixture.breakdownRows = [
      typeBucket("PRODUCT_SALES", "100"),
      typeBucket("PRODUCT_SALES", "20", { currency: "EUR" }),
      typeBucket("PRODUCT_SALES", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
      typeBucket("PRODUCT_SALES", "7", { marketplace: "Non-Amazon US" }),
    ];
    await signIn(page);
    await applyDates(page, "2026-11-05", "2026-11-06");
    const us = summaryPeriods(page, "Amazon.com");
    const japan = summaryPeriods(page, "Amazon.co.jp");
    const nonAmazon = summaryPeriods(page, "Non-Amazon US");

    await expect(summaryAmount(us.selected, "Reported amount")).toHaveText("100.00 USD");

    await expect(summaryAmount(us.selected, "Reported amount", "EUR")).toHaveText("20.00 EUR");

    await expect(summaryAmount(japan.selected, "Reported amount", "JPY")).toHaveText(
      "3,000.00 JPY",
    );

    await expect(summaryAmount(nonAmazon.selected, "Reported amount")).toHaveText("7.00 USD");
    await expect(us.summaries.getByRole("combobox")).toHaveCount(0);

    const dayCard = summaryCard(page, "Last day");
    await expect(
      dayCard.getByRole("button", {
        name: "Filter transactions to Nov 5, 2026 · UTC",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(summaryAmount(us.day, "Reported amount")).toHaveText("100.00 USD");
    await expect(summaryAmount(us.day, "Reported amount", "EUR")).toHaveText("20.00 EUR");
    await expect(japan.day).toContainText("No transactions");
    await expect(japan.day.locator("[data-amount-field]")).toHaveCount(0);
    await expect(
      summaryTable(page, "Last day").getByRole("button", { name: /^Filter transactions to / }),
    ).toHaveCount(0);
    await expect(summaryTable(page, "Last day").locator("tbody[data-marketplace]")).toHaveCount(
      marketplaces.length,
    );
    await expect(summaryPeriods(page, "Amazon.ca").day).toContainText(/No transactions/);
    await expect(us.summaries.getByRole("article")).toHaveCount(3);
    await expect(us.summaries.getByRole("radio")).toHaveCount(0);
    for (const title of ["Last day", "Last month", "Selected dates"]) {
      await expect(
        us.summaries.getByRole("article", { name: `${title} totals`, exact: true }),
      ).toBeVisible();
      await expect(summaryTable(page, title).locator("tbody[data-marketplace]")).toHaveCount(
        marketplaces.length,
      );
    }
    await us.summaries.screenshot({
      path: testInfo.outputPath(`marketplace-totals-${width}.png`),
      animations: "disabled",
    });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);

    for (const [market, marketplace, currency, expected] of [
      [us, "Amazon.com", "USD", "100.00 USD"],
      [us, "Amazon.com", "EUR", "20.00 EUR"],
      [nonAmazon, "Non-Amazon US", "USD", "7.00 USD"],
    ]) {
      await market.selected
        .getByRole("button", {
          name: `View Selected dates for ${marketplace} in ${currency} by type`,
          exact: false,
        })
        .click();
      const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
      const total = dialog.getByRole("region", { name: "Breakdown total", exact: true });
      await expect(summaryAmount(total, "Reported amount", currency)).toHaveText(expected);
      expect(fixture.breakdownRequests.at(-1).args).toMatchObject({
        p_marketplaces: [marketplace],
        p_currency: currency,
        p_date_from: "2026-11-05",
        p_date_to: "2026-11-06",
      });
      await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
    }
    expect(fixture.breakdownRequests).toHaveLength(3);
  });
}

test("a month-end latest transaction still uses the previous month for every marketplace", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-10-31", "100"),
    summaryBucket("2026-11-29", "200"),
    summaryBucket("2026-10-31", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
    summaryBucket("2026-11-30", "4000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
  ];
  fixture.breakdownRows = [typeBucket("PRODUCT_SALES", "100")];
  await signIn(page);
  const us = summaryPeriods(page, "Amazon.com");
  const japan = summaryPeriods(page, "Amazon.co.jp");

  await expect(
    summaryCard(page, "Last day").getByRole("button", {
      name: "Filter transactions to Nov 29, 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    summaryCard(page, "Last month").getByRole("button", {
      name: "Filter transactions to October 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(summaryAmount(us.day, "Reported amount")).toHaveText("200.00 USD");
  await expect(japan.day).toContainText("No transactions");
  await expect(summaryAmount(us.month, "Reported amount")).toHaveText("100.00 USD");
  await expect(summaryAmount(japan.month, "Reported amount", "JPY")).toHaveText("3,000.00 JPY");
  await us.month
    .getByRole("button", {
      name: /^View Last month for Amazon.com in USD by type:/,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
  await expect(
    summaryAmount(
      dialog.getByRole("region", { name: "Breakdown total", exact: true }),
      "Reported amount",
    ),
  ).toHaveText("100.00 USD");
  expect(fixture.breakdownRequests.at(-1).args).toMatchObject({
    p_date_from: "2026-10-01",
    p_date_to: "2026-10-31",
    p_marketplaces: ["Amazon.com"],
  });
  await expect
    .poll(() => fixture.summaryRecordRequests.at(-1)?.args)
    .toMatchObject({
      p_date_from: "2026-10-01",
      p_date_to: "2026-10-31",
      p_include_selbox: false,
    });
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await summaryCard(page, "Last month")
    .getByRole("button", {
      name: "Filter transactions to October 2026 · UTC",
      exact: true,
    })
    .click();
  await expect
    .poll(() => fixture.requests.at(-1).args)
    .toMatchObject({
      p_date_from: "2026-10-01",
      p_date_to: "2026-10-31",
    });
  await expect(summaryAmount(us.selected, "Reported amount")).toHaveText("100.00 USD");
});

test("a Data Kiosk UTC day end anchors the previous day and full month", async ({ page }) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-10-15", "5"),
    {
      ...summaryBucket("2026-11-29", "10"),
      source: "DATA_KIOSK",
      activity_at: "2026-11-30T07:59:59.999999Z",
    },
    summaryBucket("2026-10-15", "30", { marketplace: "Amazon.co.jp" }),
    summaryBucket("2026-11-29", "200", { marketplace: "Amazon.co.jp" }),
  ];
  await signIn(page);
  const us = summaryPeriods(page, "Amazon.com");
  const japan = summaryPeriods(page, "Amazon.co.jp");

  await expect(summaryCard(page, "Last day")).toContainText("Nov 29, 2026");
  await expect(summaryCard(page, "Last month")).toContainText("October 2026");
  await expect(summaryAmount(us.month, "Reported amount")).toHaveText("5.00 USD");
  await expect(us.day).toContainText("No transactions");
  await expect(summaryAmount(japan.day, "Reported amount")).toHaveText("200.00 USD");
  await expect(summaryAmount(japan.month, "Reported amount")).toHaveText("30.00 USD");
});

test("marketplace and selected-date filters never move the shared UTC day or month", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-11-30", "100"),
    summaryBucket("2026-11-05", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
  ];
  await signIn(page);
  const day = summaryCard(page, "Last day");
  const month = summaryCard(page, "Last month");
  await expect(
    day.getByRole("button", { name: "Filter transactions to Nov 29, 2026 · UTC", exact: true }),
  ).toHaveCount(1);
  await columnTrigger(page, "Marketplace").click();
  const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
  await menu.getByRole("checkbox", { name: "Amazon.co.jp", exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  const japan = summaryPeriods(page, "Amazon.co.jp");
  await expect(japan.day).toContainText("No transactions");
  await expect(japan.month).toContainText("No transactions");
  await applyDates(page, "2026-10-01", "2026-10-31");
  await expect(japan.selected).toContainText("No transactions");
  await expect(
    day.getByRole("button", { name: "Filter transactions to Nov 29, 2026 · UTC", exact: true }),
  ).toHaveCount(1);
  await expect(
    month.getByRole("button", { name: "Filter transactions to October 2026 · UTC", exact: true }),
  ).toHaveCount(1);
  expect(fixture.latestRequests).toHaveLength(1);
  expect(fixture.latestRequests[0].args).toMatchObject({
    p_company_ids: [],
    p_skus: [],
    p_marketplaces: [],
    p_date_from: null,
    p_date_to: null,
  });
});

test("all three cards follow the marketplace filter including selected markets without data", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-11-06", "100"),
    summaryBucket("2026-11-06", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
    // The in-progress UTC day anchors the populated previous-day card.
    summaryBucket("2026-11-07", "0"),
  ];
  await signIn(page);
  const table = summaryTable(page, "Last day");
  await expect(table.locator("tbody[data-marketplace]")).toHaveCount(marketplaces.length);
  await expect(summaryAmount(summaryPeriods(page).day, "Reported amount")).toHaveText("100.00 USD");
  await columnTrigger(page, "Marketplace").click();
  const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
  for (const market of ["Amazon.co.jp", "Amazon.ca"])
    await menu.getByRole("checkbox", { name: market, exact: true }).check();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(table.locator("tbody[data-marketplace]")).toHaveCount(2);
  await expect(summaryPeriods(page).day).toHaveCount(0);
  await expect(summaryPeriods(page, "Amazon.ca").day).toContainText(/No transactions/);
  await expect(
    summaryAmount(summaryPeriods(page, "Amazon.co.jp").day, "Reported amount", "JPY"),
  ).toHaveText("3,000.00 JPY");
  await page.reload();
  await expect(table.locator("tbody[data-marketplace]")).toHaveCount(2);
  await expect(summaryPeriods(page, "Amazon.ca").day).toContainText(/No transactions/);
});

for (const width of [390, 1440]) {
  test(`all three cards grow with selected marketplaces without vertical scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [
      summaryBucket("2026-11-06", "100"),
      summaryBucket("2026-11-06", "3000", { marketplace: "Amazon.co.jp", currency: "JPY" }),
    ];
    await signIn(page);
    const titles = ["Last day", "Last month", "Selected dates"];
    const cards = titles.map((title) =>
      page.getByRole("article", { name: `${title} totals`, exact: true }),
    );
    const setMarkets = async (selected) => {
      await columnTrigger(page, "Marketplace").click();
      const menu = page.getByRole("dialog", { name: "Marketplace options", exact: true });
      if (selected.length === 0) {
        await menu.getByRole("button", { name: "Clear marketplace", exact: true }).click();
      } else {
        for (const market of ["Amazon.com", "Amazon.co.jp"])
          await menu
            .getByRole("checkbox", { name: market, exact: true })
            .setChecked(selected.includes(market));
      }
      await menu.getByRole("button", { name: "Close options", exact: true }).click();
      for (const title of titles)
        await expect(summaryTable(page, title).locator("tbody[data-marketplace]")).toHaveCount(
          selected.length || marketplaces.length,
        );
      await expect(
        page.getByRole("region", { name: "Current totals", exact: true }),
      ).toHaveAttribute("aria-busy", "false");
      return Promise.all(cards.map((card) => card.boundingBox()));
    };
    const one = await setMarkets(["Amazon.com"]);
    const two = await setMarkets(["Amazon.com", "Amazon.co.jp"]);
    const all = await setMarkets([]);
    for (let index = 0; index < cards.length; index++) {
      expect(two[index].height).toBeGreaterThan(one[index].height + 10);
      expect(all[index].height).toBeGreaterThan(two[index].height + 100);
      const dimensions = await cards[index].evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollContainers: [element, ...element.querySelectorAll("*")].filter((node) => {
          const overflow = globalThis.getComputedStyle(node).overflowY;
          return ["auto", "scroll"].includes(overflow) && node.scrollHeight > node.clientHeight + 1;
        }).length,
      }));
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
      expect(dimensions.scrollContainers).toBe(0);
    }
    if (width >= 1200) {
      expect(Math.abs(all[0].y - all[1].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(all[0].y - all[2].y)).toBeLessThanOrEqual(1);
      expect(all[0].x).toBeLessThan(all[1].x);
      expect(all[1].x).toBeLessThan(all[2].x);
    } else {
      expect(all[0].y + all[0].height).toBeLessThanOrEqual(all[1].y);
      expect(all[1].y + all[1].height).toBeLessThanOrEqual(all[2].y);
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
