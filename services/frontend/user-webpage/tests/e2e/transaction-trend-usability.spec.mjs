import { expect, test } from "@playwright/test";
import { applyDates } from "./table-actions.mjs";
import {
  chartPeriodSelect,
  setupTrendPage,
  trendBucket,
  trendChart,
  trendRegion,
} from "./transaction-trend-fixtures.mjs";

async function plotVisibility(chart) {
  return chart.evaluate((figure) => {
    const scroll = figure.querySelector(".transaction-trend-scroll").getBoundingClientRect();
    const point = figure
      .querySelector(".amount-trend-period[data-inspected]")
      .getBoundingClientRect();
    const axis = figure.querySelector(".transaction-trend-axis").getBoundingClientRect();
    const bounds = figure.getBoundingClientRect();
    return {
      pointVisible:
        point.left + point.width / 2 >= scroll.left && point.left + point.width / 2 <= scroll.right,
      axisVisible: axis.left >= bounds.left && axis.right <= bounds.right,
    };
  });
}

async function groupAmountsFit(chart) {
  return chart.evaluate((figure) => {
    const bounds = figure.getBoundingClientRect();
    const scroll = figure.querySelector(".transaction-trend-values-scroll");
    const rows = [...figure.querySelectorAll(".transaction-trend-groups tbody tr")];
    return (
      rows.length > 0 &&
      scroll.scrollWidth <= scroll.clientWidth + 1 &&
      rows.every((row) => {
        const cells = [...row.querySelectorAll("[data-amount-field]")];
        return (
          cells.length === 3 &&
          cells.every((cell) => {
            const box = cell.getBoundingClientRect();
            return (
              box.left >= bounds.left &&
              box.right <= bounds.right &&
              cell.scrollWidth <= cell.clientWidth + 1
            );
          })
        );
      })
    );
  });
}

async function summaryValueOffset(chart) {
  return chart.locator(".transaction-trend-selected-amounts dd").evaluateAll((cells) => {
    const tops = cells.map((cell) => cell.getBoundingClientRect().top);
    return Math.max(...tops) - Math.min(...tops);
  });
}

async function expectSingleLineValue(cell) {
  const layout = await cell.evaluate((element) => {
    const range = globalThis.document.createRange();
    range.selectNodeContents(element.querySelector("button") ?? element);
    const fragments = [...range.getClientRects()];
    const bounds = element.getBoundingClientRect();
    return {
      lines: new Set(fragments.map((fragment) => Math.round(fragment.top))).size,
      contained: fragments.every(
        (fragment) => fragment.left >= bounds.left && fragment.right <= bounds.right,
      ),
    };
  });
  expect(layout).toEqual({ lines: 1, contained: true });
}

for (const width of [320, 390]) {
  test(`phone chart selection reveals dates and preserves its axis and page position at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupTrendPage(
      page,
      "member",
      width === 320 ? [trendBucket("2026-11-14", "-105521.96", { type: "REFERRAL_FEES" })] : [],
    );
    await page.getByRole("button", { name: "Daily trends", exact: true }).click();
    const chart = trendChart(page);
    await expect(chart).toBeVisible();
    await chart.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await expect
      .poll(() => plotVisibility(chart))
      .toEqual({ pointVisible: true, axisVisible: true });
    const selector = chartPeriodSelect(chart);
    const before = await page.evaluate(() => globalThis.scrollY);
    for (const date of ["2026-10-16", "2026-11-14"]) {
      await selector.selectOption(date);
      await expect
        .poll(() => plotVisibility(chart))
        .toEqual({ pointVisible: true, axisVisible: true });
      expect(
        Math.abs((await page.evaluate(() => globalThis.scrollY)) - before),
      ).toBeLessThanOrEqual(1);
    }
    const scroll = chart.locator(".transaction-trend-scroll");
    const atEnd = await scroll.evaluate((element) => element.scrollLeft);
    await chart.getByRole("button", { name: /^Earlier dates for / }).click();
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeLessThan(atEnd);
    expect((await plotVisibility(chart)).axisVisible).toBe(true);
    await chart.getByRole("button", { name: /^Later dates for / }).click();
    await expect
      .poll(() => plotVisibility(chart))
      .toEqual({ pointVisible: true, axisVisible: true });

    if (width === 320) {
      for (const resizedWidth of [1440, 834, 390, 320]) {
        await page.setViewportSize({ width: resizedWidth, height: 1000 });
        await expect
          .poll(() => plotVisibility(chart))
          .toEqual({ pointVisible: true, axisVisible: true });
        await expect.poll(() => groupAmountsFit(chart)).toBe(true);
        await expect.poll(() => summaryValueOffset(chart)).toBeLessThanOrEqual(1);
      }
    }
    for (const figure of await trendRegion(page).getByRole("figure").all()) {
      await expect.poll(() => groupAmountsFit(figure)).toBe(true);
      await expect.poll(() => summaryValueOffset(figure)).toBeLessThanOrEqual(1);
    }
    if (width === 320) {
      for (const field of ["reportedAmount", "companyAmount"]) {
        const cell = chart.locator(`tr[data-group-id="selling"] [data-amount-field="${field}"]`);
        await expect(cell).toHaveText("-105,521.96");
        await expectSingleLineValue(cell);
      }
      for (const [field, value] of [
        ["reportedAmount", "-105,431.96"],
        ["serviceFee", "-5.00"],
        ["companyAmount", "-105,436.96"],
      ]) {
        const cell = chart.locator(
          `.transaction-trend-selected-amounts [data-amount-field="${field}"] dd`,
        );
        await expect(cell).toHaveText(value);
        await expectSingleLineValue(cell);
      }
    }
    if (process.env.PLAYWRIGHT_CAPTURE_REVIEW === "1") {
      await page.mouse.move(0, 0);
      await chart.screenshot({
        path: testInfo.outputPath(`phone-group-amounts-${width}.png`),
        animations: "disabled",
      });
    }
    const mode = page.getByRole("button", { name: "Daily trends", exact: true });
    expect((await mode.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const empty = trendRegion(page)
      .locator(".transaction-trends-marketplace")
      .filter({ hasText: "No transactions" })
      .first();
    expect((await empty.boundingBox()).height).toBeLessThanOrEqual(64);
    await trendRegion(page).getByRole("button", { name: "Search & filters", exact: true }).click();
    await expect(page.getByLabel("Search", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Search", { exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Back to summaries", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Transaction summary", exact: true }),
    ).toBeFocused();
    await expect(mode).toBeInViewport();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("one keyboard stop explores clipped weeks and opens the exact selected period", async ({
  page,
}) => {
  const fixture = await setupTrendPage(page, "member", [trendBucket("2026-11-05", "12")]);
  fixture.breakdownRows = fixture.aggregateRows.filter((row) => row.activity_date === "2026-11-05");
  await applyDates(page, "2026-11-04", "2026-11-14");
  await page.getByRole("button", { name: "Weekly trends", exact: true }).click();
  const chart = trendChart(page, "USD", "Weekly");
  await expect(chart).toBeVisible();
  const tabStop = chart.locator('.amount-trend-plot button[tabindex="0"]');
  await expect(tabStop).toHaveCount(1);
  expect(
    await chart
      .locator(".amount-trend-segment-action")
      .evaluateAll((buttons) => buttons.every((button) => button.tabIndex === -1)),
  ).toBe(true);
  await tabStop.focus();
  await page.keyboard.press("Home");
  await expect(chartPeriodSelect(chart, "week")).toHaveValue("2026-11-02");
  await expect(chart.locator(".amount-trend-period[data-inspected]")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(chartPeriodSelect(chart, "week")).toHaveValue("2026-11-09");
  await page.keyboard.press("ArrowLeft");
  await expect(chartPeriodSelect(chart, "week")).toHaveValue("2026-11-02");
  await page.keyboard.press("End");
  await expect(chartPeriodSelect(chart, "week")).toHaveValue("2026-11-09");
  await chart.getByRole("button", { name: /^Previous week for / }).click();
  await expect(chartPeriodSelect(chart, "week")).toHaveValue("2026-11-02");
  await expect(chart.getByRole("button", { name: /^Previous week for / })).toBeDisabled();
  await chart.getByRole("button", { name: /^Open week details for / }).click();
  const dialog = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => fixture.breakdownRequests.at(-1)?.args)
    .toMatchObject({
      p_date_from: "2026-11-04",
      p_date_to: "2026-11-08",
      p_marketplaces: ["Amazon.com"],
      p_currency: "USD",
    });
});

test("a single day fits a phone and zero-amount groups retain a usable details action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const fixture = await setupTrendPage(page, "member", [
    trendBucket("2026-11-14", "0", { type: "ZERO_ACTIVITY" }),
  ]);
  fixture.breakdownRows = fixture.aggregateRows.filter(
    (row) =>
      row.activity_date === "2026-11-14" &&
      row.marketplace_name === "Amazon.com" &&
      row.currency === "USD",
  );
  await applyDates(page, "2026-11-14", "2026-11-14");
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const chart = trendChart(page);
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".amount-trend-period")).toHaveCount(1);
  await expect.poll(() => plotVisibility(chart)).toEqual({ pointVisible: true, axisVisible: true });
  expect(
    await chart
      .locator(".transaction-trend-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await expect(chart.getByRole("button", { name: /^Previous day for / })).toBeDisabled();
  await expect(chart.getByRole("button", { name: /^Next day for / })).toBeDisabled();
  const amounts = chart.locator(".transaction-trend-selected-amounts");
  await expect(amounts.locator('[data-amount-field="reportedAmount"] dd')).toHaveText("90.00");
  await expect(amounts.locator('[data-amount-field="serviceFee"] dd')).toHaveText("-5.00");
  await expect(amounts.locator('[data-amount-field="companyAmount"] dd')).toHaveText("85.00");
  const zero = chart
    .locator('tr[data-group-id="other"] [data-amount-field="companyAmount"]')
    .getByRole("button");
  await expect(zero).toHaveText("0.00");
  await zero.click();
  const dialog = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  const group = dialog.getByRole("button", {
    name: "Other fees & adjustments details",
    exact: true,
  });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeFocused();
  await expect
    .poll(() => fixture.breakdownRequests.at(-1)?.args)
    .toMatchObject({ p_date_from: "2026-11-14", p_date_to: "2026-11-14" });
});
