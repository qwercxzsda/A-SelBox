import { expect, test } from "./accessibility-fixture.mjs";
import { applyDates, openColumn, selectColumnOptions } from "./table-actions.mjs";
import {
  TREND_COMPANY as COMPANY,
  chartPeriodSelect,
  selectedTrendAmount,
  setupTrendPage as setup,
  trendBucket as bucket,
  trendChart,
  trendRegion,
} from "./transaction-trend-fixtures.mjs";

test("trend modes use complete default UTC windows and preserve separate marketplace currencies", async ({
  page,
}, testInfo) => {
  const fixture = await setup(page);
  expect(fixture.trendRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const daily = trendRegion(page);
  await expect(trendChart(page)).toBeVisible();
  await expect(trendChart(page, "CAD")).toBeVisible();
  await expect(trendChart(page, "EUR")).toBeVisible();
  await expect(daily.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Chart amount", exact: true })).toHaveCount(0);
  await expect(daily).toContainText("Amazon.com");
  await expect(daily).toContainText("Amazon.ca");
  await expect(trendChart(page)).toContainText("Sales & refunds");
  await expect(trendChart(page)).toContainText("Storage & inventory");
  await expect(trendChart(page)).not.toContainText("Customer sales and refunds");
  await expect(trendChart(page)).not.toContainText(/running|cumulative/i);
  await expect(trendChart(page).locator(".amount-trend-total-line")).toHaveCount(1);
  await expect(trendChart(page).locator("figcaption")).toHaveCount(0);
  await expect(trendChart(page).locator(".amount-trend-total-line")).toHaveCSS(
    "stroke",
    "rgb(0, 0, 0)",
  );
  await expect(trendChart(page).locator(".amount-trend-dot").first()).toHaveCSS(
    "border-color",
    "rgb(0, 0, 0)",
  );
  expect(
    await trendChart(page).locator(".amount-trend-bar[data-family-id='inventory']").count(),
  ).toBeGreaterThan(0);
  await expect(trendChart(page).locator(".amount-trend-family-line")).toHaveCount(0);
  await expect(selectedTrendAmount(trendChart(page))).toHaveText("85.00");
  const lastDay = trendChart(page).locator('.amount-trend-period[data-period="2026-11-14"]');
  const reportedBar = lastDay.locator(
    '.amount-trend-bar[data-family-id="sales"][data-part="reported"]',
  );
  const feeBar = lastDay.locator(
    '.amount-trend-bar[data-family-id="sales"][data-part="serviceFee"]',
  );
  await expect(reportedBar).toBeVisible();
  await expect(reportedBar).toHaveAttribute("title", /100\.00 USD/);
  await expect(feeBar).toBeVisible();
  await expect(feeBar).toHaveAttribute("title", /-5\.00 USD/);
  await expect(feeBar).not.toHaveCSS("background-image", "none");
  await expect(
    lastDay.locator('.amount-trend-bar[data-family-id="inventory"][data-part="serviceFee"]'),
  ).toHaveCount(0);
  const sales = trendChart(page).locator('tr[data-group-id="sales"]');
  await expect(sales.locator('[data-amount-field="reportedAmount"]')).toHaveText("100.00");
  await expect(sales.locator('[data-amount-field="serviceFee"]')).toHaveText("-5.00");
  await expect(sales.locator('[data-amount-field="companyAmount"]')).toHaveText("95.00");
  await expect(selectedTrendAmount(trendChart(page, "CAD"))).toHaveText("30.00");
  await expect(selectedTrendAmount(trendChart(page, "EUR"))).toHaveText("5.00");
  expect(fixture.trendRequests).toHaveLength(1);
  expect(fixture.trendRequests[0].args).not.toHaveProperty("p_limit");
  expect(fixture.trendRequests[0].args).not.toHaveProperty("p_offset");
  for (const { args } of fixture.trendRequests)
    expect(args).toMatchObject({
      p_granularity: "day",
      p_date_from: "2026-10-16",
      p_date_to: "2026-11-14",
    });
  if (process.env.PLAYWRIGHT_CAPTURE_REVIEW === "1") {
    await daily
      .getByRole("heading", { name: "Daily trends", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("desktop-daily-overview.png"),
      animations: "disabled",
    });
    await chartPeriodSelect(trendChart(page)).selectOption("2026-11-14");
    await page.mouse.move(0, 0);
    await trendChart(page).screenshot({
      path: testInfo.outputPath("desktop-daily-trends.png"),
      animations: "disabled",
    });
  }

  await page.getByRole("button", { name: "Weekly trends", exact: true }).click();
  await expect(trendChart(page, "USD", "Weekly")).toBeVisible();
  await expect(trendChart(page, "CAD", "Weekly")).toBeVisible();
  await expect(selectedTrendAmount(trendChart(page, "USD", "Weekly"))).toHaveText("70.00");
  await expect(trendChart(page, "USD", "Weekly")).not.toContainText(/running|cumulative/i);
  await expect(trendChart(page, "USD", "Weekly").locator(".amount-trend-total-line")).toHaveCount(
    1,
  );
  await expect(trendChart(page, "USD", "Weekly").locator(".amount-trend-family-line")).toHaveCount(
    0,
  );
  await expect(trendChart(page, "USD", "Weekly").locator("figcaption")).toHaveCount(0);
  await expect(trendChart(page, "USD", "Weekly").locator(".amount-trend-total-line")).toHaveCSS(
    "stroke",
    "rgb(0, 0, 0)",
  );
  await expect(trendChart(page, "USD", "Weekly").locator(".amount-trend-dot").first()).toHaveCSS(
    "border-color",
    "rgb(0, 0, 0)",
  );
  const weekly = fixture.trendRequests.filter(({ args }) => args.p_granularity === "week");
  expect(weekly).toHaveLength(1);
  for (const { args } of weekly)
    expect(args).toMatchObject({ p_date_from: "2025-11-01", p_date_to: "2026-10-31" });
  if (process.env.PLAYWRIGHT_CAPTURE_REVIEW === "1")
    await trendChart(page, "USD", "Weekly").screenshot({
      path: testInfo.outputPath("desktop-weekly-trends.png"),
      animations: "disabled",
    });

  await page.getByRole("button", { name: "Current totals", exact: true }).click();
  await expect(page.getByRole("region", { name: "Current totals", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: / totals$/ })).toHaveCount(3);
  await expect(page.getByRole("figure")).toHaveCount(0);
});

test("trend marketplace order follows current totals through date changes and reload", async ({
  page,
}) => {
  await setup(page, "member", [
    bucket("2026-10-15", "25", { marketplace: "Amazon.ae", currency: "AED" }),
    bucket("2026-11-10", "35", { marketplace: "Amazon.ae", currency: "AED" }),
  ]);
  const totals = page.getByRole("region", { name: "Current totals", exact: true });
  const totalOrder = () =>
    totals
      .getByRole("table", { name: "Last month marketplace totals", exact: true })
      .locator("tbody[data-marketplace]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.marketplace));
  const trendOrder = (mode) =>
    trendRegion(page, mode)
      .locator(".transaction-trends-marketplace")
      .evaluateAll((rows) => rows.map((row) => row.dataset.marketplace));
  await expect(totals).toHaveAttribute("aria-busy", "false");
  const original = await totalOrder();
  // AE has activity in both trend windows, but no Last day activity; current totals put it third.
  expect(original.slice(0, 3)).toEqual(["Amazon.ca", "Amazon.com", "Amazon.ae"]);
  for (const mode of ["Daily", "Weekly"]) {
    await page.getByRole("button", { name: `${mode} trends`, exact: true }).click();
    await expect.poll(() => trendOrder(mode)).toEqual(original);
  }
  await applyDates(page, "2026-11-01", "2026-11-10");
  const selected = ["Amazon.ae", ...original.filter((marketplace) => marketplace !== "Amazon.ae")];
  await expect.poll(() => trendOrder("Weekly")).toEqual(selected);
  await page.reload();
  await expect(page.getByRole("button", { name: "Weekly trends", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => trendOrder("Weekly"), { timeout: 15_000 }).toEqual(selected);
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  await expect.poll(() => trendOrder("Daily")).toEqual(selected);
  await page.getByRole("button", { name: "Current totals", exact: true }).click();
  await expect(totals).toHaveAttribute("aria-busy", "false");
  expect(await totalOrder()).toEqual(selected);
});

test("daily and weekly charts share all applied transaction filters and replace default dates", async ({
  page,
}) => {
  const fixture = await setup(page, "administrator");
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  await expect(trendChart(page)).toBeVisible();
  await applyDates(page, "2026-11-01", "2026-11-14");
  await selectColumnOptions(page, "Company", ["Trend Company"]);
  await selectColumnOptions(page, "Marketplace", ["Amazon.com"]);
  await selectColumnOptions(page, "SKU", ["ALPHA"]);
  await selectColumnOptions(page, "Source", ["Finances"]);
  const types = await openColumn(page, "Type");
  await types.getByLabel("Search type", { exact: true }).fill("Product sales");
  await types.getByRole("checkbox", { name: "Product sales", exact: true }).check();
  await types.getByRole("button", { name: "Close options", exact: true }).click();
  await selectColumnOptions(page, "Service fee", ["Applicable"]);
  await page.getByLabel("Search", { exact: true }).fill("ALPHA");
  const scope = {
    p_date_from: "2026-11-01",
    p_date_to: "2026-11-14",
    p_company_ids: [COMPANY],
    p_marketplaces: ["Amazon.com"],
    p_skus: ["ALPHA"],
    p_sources: ["FINANCES"],
    p_types: ["PRODUCT_SALES"],
    p_fee_applicable: true,
    p_search_skus: ["ALPHA"],
    p_search_types: [],
    p_search_marketplaces: [],
    p_search_sources: [],
  };
  await expect.poll(() => fixture.trendRequests.at(-1)?.args).toMatchObject(scope);
  await expect(selectedTrendAmount(trendChart(page))).toHaveText("95.00");
  await expect(trendChart(page)).not.toContainText("Storage & inventory");
  await expect(trendChart(page, "CAD")).toHaveCount(0);

  await page.getByRole("button", { name: "Weekly trends", exact: true }).click();
  await expect(trendChart(page, "USD", "Weekly")).toBeVisible();
  await expect
    .poll(() => fixture.trendRequests.at(-1)?.args)
    .toMatchObject({
      ...scope,
      p_granularity: "week",
    });
  await expect(selectedTrendAmount(trendChart(page, "USD", "Weekly"))).toHaveText("95.00");

  await page.getByLabel("Search", { exact: true }).fill("NO MATCHING SKU");
  await expect.poll(() => fixture.trendRequests.at(-1)?.args.p_search_skus).toEqual([]);
  await expect(trendRegion(page, "Weekly").getByRole("figure")).toHaveCount(0);
  await expect(trendRegion(page, "Weekly")).toContainText("No transactions");
});

test("reported and service fee bars open the scoped totals drawer at their shared group", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.breakdownRows = fixture.aggregateRows.filter(
    (row) =>
      row.activity_date === "2026-11-14" &&
      row.marketplace_name === "Amazon.com" &&
      row.currency === "USD",
  );
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const chart = trendChart(page);
  await expect(chart).toBeVisible();
  for (const part of ["reported", "serviceFee"]) {
    await chart
      .locator(
        `.amount-trend-segment-action[data-period="2026-11-14"][data-family-id="sales"][data-part="${part}"]`,
      )
      .click();
    const dialog = page.getByRole("dialog", { name: "Transaction totals", exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => fixture.breakdownRequests.at(-1)?.args)
      .toMatchObject({
        p_date_from: "2026-11-14",
        p_date_to: "2026-11-14",
        p_marketplaces: ["Amazon.com"],
        p_currency: "USD",
      });
    const group = dialog.getByRole("button", { name: "Sales & refunds details", exact: true });
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(group).toBeFocused();
    await expect(group).toBeInViewport();
    await expect(
      dialog.getByRole("region", { name: "Breakdown total", exact: true }),
    ).toContainText("85.00 USD");
    await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

test("unknown company amounts are exposed without drawing them as known zero", async ({ page }) => {
  const unknown = bucket("2026-11-12", "50", {
    companyAmount: null,
    serviceFee: null,
    knownCompanyCount: 0,
  });
  const fixture = await setup(page, "member", [unknown]);
  fixture.breakdownRows = [unknown];
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const chart = trendChart(page);
  await expect(chart).toContainText("The chart includes calculated company amounts only");
  const day = chart.locator('.amount-trend-period[data-period="2026-11-12"]');
  await day.focus();
  await expect(day).toBeFocused();
  await expect(chart).toContainText("Unknown");
  const amounts = chart.locator(".transaction-trend-selected-amounts");
  await expect(amounts.locator('[data-amount-field="reportedAmount"] dd')).toHaveText("50.00");
  await expect(amounts.locator('[data-amount-field="serviceFee"] dd')).toHaveText("Unknown");
  await expect(amounts.locator('[data-amount-field="companyAmount"] dd')).toHaveText("Unknown");
  await chart
    .locator('tr[data-group-id="sales"] [data-amount-field="companyAmount"]')
    .getByRole("button")
    .click();
  const dialog = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  const group = dialog.getByRole("button", { name: "Sales & refunds details", exact: true });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(group).toBeFocused();
  await expect
    .poll(() => fixture.breakdownRequests.at(-1)?.args)
    .toMatchObject({ p_date_from: "2026-11-12", p_date_to: "2026-11-12" });
});

test("trend failures can be retried without losing the selected mode", async ({ page }) => {
  const fixture = await setup(page);
  fixture.trendStatus = 500;
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const daily = trendRegion(page);
  await expect(daily.getByRole("alert")).toBeVisible();
  await expect(daily.getByRole("figure")).toHaveCount(0);
  fixture.trendStatus = 200;
  await daily.getByRole("button", { name: /Retry/ }).click();
  await expect(trendChart(page)).toBeVisible();
  await expect(daily.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Daily trends", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("trend charts remain keyboard accessible and contained on a narrow screen", async ({
  page,
  expectAccessible,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Daily trends", exact: true }).click();
  const chart = trendChart(page);
  await expect(chart).toBeVisible();
  const day = chart.locator('.amount-trend-period[data-period="2026-11-14"]');
  await day.focus();
  await expect(day).toBeFocused();
  await expect(selectedTrendAmount(chart)).toHaveText("85.00");
  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
  await expectAccessible("transaction-daily-trends-phone");
  await page.getByRole("button", { name: "Weekly trends", exact: true }).click();
  await expect(trendChart(page, "USD", "Weekly")).toBeVisible();
  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
  await expectAccessible("transaction-weekly-trends-phone");
});
