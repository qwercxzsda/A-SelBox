import { expect, test } from "./accessibility-fixture.mjs";
import marketplaces from "../../src/generated/marketplaces.json" with { type: "json" };
import { sourceDetail, sourceRoutes } from "./financial-source-fixtures.mjs";
import {
  monthsTable,
  openFinancialReview,
  reviewDrawer,
  reviewMeasure,
  reviewOutcome,
  reviewRowId,
} from "./financial-review-fixtures.mjs";

const totals = (page) => page.getByLabel("2025 totals", { exact: true });
const chart = (page) => page.getByRole("region", { name: "Differences by month", exact: true });
const latestRequest = (fixture, endpoint) =>
  fixture.reviewRequests.filter((request) => request.endpoint.endsWith(endpoint)).at(-1)?.params;
const reasonTable = (drawer) =>
  drawer.getByRole("table", { name: "Differences by reason", exact: true });
const differenceRecords = (drawer) =>
  drawer.getByRole("table", { name: "Difference records", exact: true });
const reviewLink = (query) =>
  `/?tab=financial-review&marketplace=Amazon.com&year=2025${query ? `&${query}` : ""}`;

function differenceOutcomes(month, reason, count, first) {
  return Array.from({ length: count }, (_, index) =>
    reviewOutcome(first + index, {
      posted_date: `${month}-20`,
      reason,
      sku: `SKU-${String(first + index)}`,
      base_amount: "-1",
      tax_amount: "0",
    }),
  );
}

test("the scope is one marketplace and one year from constant options, kept in the URL", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page);
  const marketplace = page.getByLabel("Marketplace", { exact: true });
  await expect(marketplace).toHaveValue("Amazon.com");
  await expect(marketplace.locator("option")).toHaveText(marketplaces);
  const latest = new Date().getUTCFullYear();
  await expect(page.getByLabel("Year", { exact: true }).locator("option")).toHaveText(
    Array.from({ length: latest - 2023 }, (_, index) => String(latest - index)),
  );
  await expect(page.getByRole("tab", { name: "Differences", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Currency", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/marketplace=Amazon\.com&year=2025/);
  expect(Object.fromEntries(latestRequest(fixture, "financial_review_months"))).toMatchObject({
    p_marketplace: "Amazon.com",
    p_year: "2025",
  });

  await marketplace.selectOption("Amazon.de");
  await expect
    .poll(() => latestRequest(fixture, "financial_review_months").get("p_marketplace"))
    .toBe("Amazon.de");
  await expect(page.getByText("No activity in 2025", { exact: true })).toBeVisible();
  await expect(chart(page).getByText("No differences in 2025", { exact: true })).toBeVisible();
  await expect(totals(page).getByText("0.00 EUR", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Marketplace", { exact: true })).toHaveValue("Amazon.de");
  await expect(page.getByLabel("Year", { exact: true })).toHaveValue("2025");
});

test("the year's totals and months include tax, with the running difference", async ({ page }) => {
  await openFinancialReview(page);
  for (const [name, amount, tax] of [
    ["Finances", "-171.8002 USD", "Tax: -15.80"],
    ["Company amounts", "-165.00 USD", "Tax: -15.00"],
    ["SelBox types", "-3.50 USD", "Tax: -0.50"],
    ["Differences", "-3.3002 USD", "Tax: -0.30"],
  ]) {
    const card = totals(page).locator(".financial-review-total").filter({ hasText: name });
    await expect(card.locator(".financial-review-total-value")).toHaveText(amount);
    await expect(card.locator(".financial-review-total-tax")).toHaveText(tax);
  }
  const running = (month) =>
    monthsTable(page)
      .getByRole("row", { name: new RegExp(`^${month}`) })
      .locator('[data-column="running_difference"]');
  await expect(
    monthsTable(page)
      .getByRole("row", { name: /^January 2025/ })
      .locator('[data-column="difference"]'),
  ).toContainText("-4.4002Tax: -0.40");
  await expect(running("January 2025")).toHaveText("-4.4002");
  await expect(running("January 2025")).toHaveCSS("font-weight", "700");
  await expect(running("February 2025")).toHaveText("-3.3002");
  await expect(running("April 2025")).toHaveText("-3.3002");
  await expect(monthsTable(page).getByRole("row", { name: /^March 2025/ })).toHaveCount(0);
});

test("titles, cards and row headers use the shared type scale", async ({ page }) => {
  await openFinancialReview(page);
  for (const name of ["Differences by month", "Months"]) {
    const title = page.getByRole("heading", { name, exact: true });
    await expect(title).toHaveCSS("font-size", "16px");
    await expect(title).toHaveCSS("font-weight", "600");
  }
  const card = totals(page).locator(".financial-review-total").first();
  await expect(card.locator("dt")).toHaveCSS("font-size", "12px");
  await expect(card.locator("dt")).toHaveCSS("font-weight", "600");
  await expect(card.locator(".financial-review-total-value")).toHaveCSS("font-size", "16px");
  await expect(card.locator(".financial-review-total-value")).toHaveCSS("font-weight", "600");
  await expect(
    monthsTable(page).getByRole("rowheader", { name: "January 2025", exact: true }),
  ).toHaveCSS("background-color", "rgb(247, 249, 251)");
  // The Months title shares the table's status row instead of standing above a blank line.
  const title = await page.getByRole("heading", { name: "Months", exact: true }).boundingBox();
  const table = await monthsTable(page).boundingBox();
  expect(table.y - (title.y + title.height)).toBeLessThan(16);
});

test("a month that does not add up, or another currency, fails loudly without totals", async ({
  page,
}) => {
  const fixture = await openFinancialReview(page, {
    configure(state) {
      state.reviewMonths[1] = reviewMeasure("2025-01", "COMPANY", "-90.0001", "-9", null, 10);
    },
  });
  const alert = page.getByRole("alert").filter({ hasText: "January 2025 does not add up" });
  await expect(alert).toContainText("Finances base -99.0002 USD");
  await expect(totals(page).locator(".financial-review-total-value").first()).toHaveText("—");
  await expect(monthsTable(page).locator("tbody tr")).toHaveCount(0);
  await expect(chart(page).locator(".amount-trend-period")).toHaveCount(0);
  // A failed check is not loading: neither region stays busy.
  await expect(chart(page)).toHaveAttribute("aria-busy", "false");
  await expect(totals(page)).toHaveAttribute("aria-busy", "false");

  fixture.reviewMonths[1] = reviewMeasure("2025-01", "COMPANY", "-90", "-9", null, 10, {
    currency: "EUR",
  });
  await alert.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "returned EUR for Amazon.com, which charges in USD",
  );
});

test("the chart stacks each month's differences by reason with gaps and keyboard months", async ({
  page,
}) => {
  await openFinancialReview(page);
  const figure = chart(page);
  const zero = await figure.locator(".amount-trend-zero-line").boundingBox();
  const bar = async (month, reason) =>
    figure
      .locator(
        `.amount-trend-period[data-period="${month}"] .amount-trend-bar[data-family-id="${reason}"]`,
      )
      .boundingBox();
  const noAssignment = await bar("2025-01", "NO_ASSIGNMENT");
  const rounding = await bar("2025-01", "ROUNDING");
  const notInLedger = await bar("2025-02", "NOT_IN_LEDGER");
  expect(Math.abs(noAssignment.y - zero.y)).toBeLessThan(1.5);
  expect(rounding.y).toBeGreaterThanOrEqual(noAssignment.y + noAssignment.height - 1.5);
  expect(Math.abs(notInLedger.y + notInLedger.height - zero.y)).toBeLessThan(1.5);
  await expect(
    figure.locator('.amount-trend-bar[data-family-id="NO_ASSIGNMENT"]').first(),
  ).toHaveCSS("background-color", "rgb(42, 120, 214)");
  await expect(figure.locator(".amount-trend-gap").filter({ hasText: "Mar" })).toHaveCount(1);
  // The keyboard target (the last month) is not shaded until it is hovered or focused.
  const target = figure.locator(".amount-trend-period[data-inspected]");
  await expect(target).toHaveAttribute("data-period", "2025-04");
  await expect(target).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(figure.locator(".amount-trend-total-line")).toHaveCount(2);
  await expect(figure.locator(".amount-trend-family-line")).toHaveCount(0);
  await expect(
    figure.getByRole("list", { name: "Reasons with year totals" }).getByRole("listitem"),
  ).toHaveText([
    "No assignment -6.60 USD",
    "Not in ledger 3.30 USD",
    "Rounding errors -0.0002 USD",
  ]);

  const january = figure.getByRole("button", { name: "Jan: Open January 2025", exact: true });
  await january.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    figure.getByRole("button", { name: "Feb: Open February 2025", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const april = figure.getByRole("button", { name: "Apr: Open April 2025", exact: true });
  await expect(april).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = reviewDrawer(page, "April 2025");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("No differences in April 2025.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(april).toBeFocused();
});

test("a reason segment opens its month with that reason selected", async ({ page }) => {
  const fixture = await openFinancialReview(page);
  await chart(page)
    .locator('.amount-trend-segment-action[data-period="2025-02"][data-family-id="NOT_IN_LEDGER"]')
    .click();
  const drawer = reviewDrawer(page, "February 2025");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/row=2025-02&reason=NOT_IN_LEDGER/);
  const chip = drawer.getByRole("button", { name: "Remove Reason: Not in ledger", exact: true });
  await expect(chip).toBeVisible();
  await expect
    .poll(() => latestRequest(fixture, "financial_outcome_page")?.get("p_reason"))
    .toBe("NOT_IN_LEDGER");
  const records = drawer.getByRole("table", { name: "Difference records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(records.getByRole("columnheader", { name: "Reason" })).toHaveCount(0);
  await chip.click();
  await expect(records.locator("tbody tr")).toHaveCount(2);
  await expect(records.getByRole("columnheader", { name: "Reason" })).toBeVisible();
  expect(latestRequest(fixture, "financial_outcome_page").has("p_reason")).toBe(false);
  await drawer
    .getByRole("table", { name: "Differences by reason", exact: true })
    .getByRole("row", { name: /No assignment/ })
    .click();
  await expect(
    drawer.getByRole("button", { name: "Remove Reason: No assignment", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/reason=NO_ASSIGNMENT/);
});

test("the month drawer shows totals, differences, SelBox types and payout readiness", async ({
  page,
}) => {
  await openFinancialReview(page);
  await monthsTable(page)
    .getByRole("row", { name: /^January 2025/ })
    .click();
  const drawer = reviewDrawer(page, "January 2025");
  await expect(drawer.locator(".detail-drawer-context")).toHaveText("Amazon.com · USD");
  await expect(page).toHaveURL(/row=2025-01/);
  const monthTotals = drawer.getByLabel("January 2025 totals", { exact: true });
  await expect(monthTotals.locator(".financial-review-total-value").first()).toHaveText(
    "-108.9002 USD",
  );
  const reasons = reasonTable(drawer);
  // Amounts include tax with the tax beneath, like the totals and the records.
  await expect(reasons.getByRole("columnheader")).toHaveText(["Reason", "Amount", "Records"]);
  await expect(
    reasons.getByRole("row", { name: /No assignment/ }).locator('[data-column="amount"]'),
  ).toHaveText("-4.40Tax: -0.40");
  await expect(reasons.getByRole("row", { name: /Rounding errors/ })).toContainText("-0.0002");
  const records = differenceRecords(drawer);
  await expect(records.locator("tbody tr")).toHaveCount(3);
  await expect(records.getByRole("row", { name: /SKU-01/ })).toHaveAttribute(
    "aria-haspopup",
    "dialog",
  );
  await expect(records.getByRole("row", { name: /SKU-02/ })).not.toHaveAttribute(
    "aria-haspopup",
    "dialog",
  );
  await expect(records.getByRole("row", { name: /SKU-01/ })).toContainText("FNSKU: X000000001");
  await expect(drawer.getByText("Page 1 · 3 records", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Close January 2025", exact: true }),
  ).toBeVisible();

  const selbox = drawer.getByRole("button", { name: "SelBox types", exact: true });
  await expect(selbox).toHaveAttribute("aria-expanded", "false");
  await selbox.click();
  await expect(
    drawer.getByRole("table", { name: "SelBox types by group", exact: true }),
  ).toContainText("Account fees");
  const selboxRecords = drawer.getByRole("table", { name: "SelBox type records", exact: true });
  await expect(selboxRecords).toContainText("-5.50");
  await expect(selboxRecords).toContainText("Subscription fees");
  const readiness = drawer.getByRole("button", { name: "Payout readiness", exact: true });
  await expect(readiness).toHaveAttribute("aria-expanded", "false");
  await readiness.click();
  await expect(drawer.getByRole("region", { name: "January 2025 payout readiness" })).toBeVisible();

  // One labelled month navigation in the header, apart from the record pagers.
  const navigation = page.getByRole("navigation", { name: "Months in 2025", exact: true });
  await expect(drawer.locator(".mantine-Drawer-header").getByRole("navigation")).toHaveCount(1);
  await expect(navigation.getByRole("button")).toHaveText(["Previous month", "Next month"]);
  await expect(
    navigation.getByRole("button", { name: "Previous month", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  const before = await navigation.boundingBox();
  await navigation.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(reviewDrawer(page, "February 2025")).toBeVisible();
  await expect(page).toHaveURL(/row=2025-02/);
  expect(await navigation.boundingBox()).toEqual(before);
  await page.reload();
  await expect(reviewDrawer(page, "February 2025")).toBeVisible();
});

test("balancing records show Finances and open the charge's Finances record", async ({ page }) => {
  await openFinancialReview(page, {
    configure(state) {
      // A totals difference of the same charge shares the rounding record's source IDs.
      state.reviewMonths[0] = reviewMeasure("2025-01", "FINANCES", "-100.0002", "-9.9", null, 15);
      state.reviewMonths.push(reviewMeasure("2025-01", "DIFFERENCE", "-1", "0", "TOTALS_DIFFER"));
      state.reviewOutcomes.push(
        reviewOutcome(3, {
          source: "KEY",
          reason: "TOTALS_DIFFER",
          base_amount: "-1",
          tax_amount: "0",
          sku: null,
        }),
      );
    },
  });
  const source = await sourceRoutes(page);
  await page.goto(reviewLink("row=2025-01"));
  const drawer = reviewDrawer(page, "January 2025");
  const records = differenceRecords(drawer);
  const rounding = records.getByRole("row", { name: /Rounding errors/ });
  const totalsDiffer = records.getByRole("row", { name: /Totals differ/ });
  await expect(rounding.locator('[data-column="source"]')).toHaveText("Finances");
  await expect(totalsDiffer.locator('[data-column="source"]')).toHaveText("Finances");
  await expect(rounding).toHaveAttribute("aria-haspopup", "dialog");
  await rounding.click();
  await expect(sourceDetail(page)).toBeVisible();
  expect(source.requests.at(-1)).toMatchObject({
    p_source: "FINANCES",
    p_row_id: reviewRowId(3),
    p_version_id: reviewRowId(1003),
  });
  // Only the opened row is selected, although both name the same charge. The record drawer
  // stacks over the month, so read the month's rows from the document.
  const selected = page.locator(
    'table[aria-label="Difference records"] tbody tr[aria-selected="true"]',
  );
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("Rounding errors");
});

test("an opened record stays with its month; Back or a link to another month closes it", async ({
  page,
}) => {
  await openFinancialReview(page);
  const source = await sourceRoutes(page);
  const january = reviewDrawer(page, "January 2025");
  const february = reviewDrawer(page, "February 2025");
  const openJanuaryRecord = async () => {
    await differenceRecords(january)
      .getByRole("row", { name: /SKU-01/ })
      .click();
    await expect(sourceDetail(page)).toBeVisible();
  };
  await monthsTable(page)
    .getByRole("row", { name: /^January 2025/ })
    .click();
  await openJanuaryRecord();
  // A reload keeps the record over its month (the stacked month leaves the accessibility tree).
  await page.reload();
  await expect(sourceDetail(page)).toBeVisible();
  await expect(page).toHaveURL(/row=2025-01/);
  // Back closes the month and its record; neither another month nor the same one reopens it.
  await page.goBack();
  await expect(january).toBeHidden();
  await expect(sourceDetail(page)).toBeHidden();
  await monthsTable(page)
    .getByRole("row", { name: /^February 2025/ })
    .click();
  await expect(february).toBeVisible();
  await expect(sourceDetail(page)).toBeHidden();
  await february.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(january).toBeVisible();
  await expect(sourceDetail(page)).toBeHidden();
  // A link to another month in the same tab does not open the record either.
  await openJanuaryRecord();
  const lookups = source.requests.length;
  await page.goto(reviewLink("row=2025-02"));
  await expect(february).toBeVisible();
  await expect(sourceDetail(page)).toBeHidden();
  expect(source.requests).toHaveLength(lookups);
});

test("Back from a corrected link returns to the page before it", async ({ page }) => {
  await openFinancialReview(page);
  await page.goto(reviewLink("row=2025-01"));
  await expect(reviewDrawer(page, "January 2025")).toBeVisible();
  // March has no activity: the link is corrected in place, not by a new history entry.
  await page.goto(reviewLink("row=2025-03&reason=ROUNDING"));
  await expect(page).not.toHaveURL(/row=|reason=/);
  await page.goBack();
  await expect(page).toHaveURL(/row=2025-01/);
  await expect(reviewDrawer(page, "January 2025")).toBeVisible();
  // February lacks rounding errors: only reason= leaves, and Back reaches January again.
  await page.goto(reviewLink("row=2025-02&reason=ROUNDING"));
  await expect(reviewDrawer(page, "February 2025")).toBeVisible();
  await expect(page).not.toHaveURL(/reason=/);
  await page.goBack();
  await expect(page).toHaveURL(/row=2025-01/);
  await expect(reviewDrawer(page, "January 2025")).toBeVisible();
});

test("an unknown record source fails loudly", async ({ page }) => {
  await openFinancialReview(page, {
    configure(state) {
      state.reviewOutcomes[0] = { ...state.reviewOutcomes[0], source: "SETTLEMENT" };
    },
  });
  await page.goto(reviewLink("row=2025-01"));
  await expect(reviewDrawer(page, "January 2025").getByRole("alert")).toContainText(
    "Could not load difference records",
  );
  await expect(differenceRecords(reviewDrawer(page, "January 2025"))).toHaveCount(0);
});

test("a reason that nets to zero over the year still charts its months", async ({ page }) => {
  await openFinancialReview(page, {
    configure(state) {
      state.reviewMonths = [
        reviewMeasure("2025-01", "FINANCES", "0", "0", null, 2),
        reviewMeasure("2025-01", "COMPANY", "-5", "0"),
        reviewMeasure("2025-01", "DIFFERENCE", "5", "0", "CHARGED_IN_ANOTHER_MONTH"),
        reviewMeasure("2025-02", "FINANCES", "0", "0", null, 2),
        reviewMeasure("2025-02", "COMPANY", "5", "0"),
        reviewMeasure("2025-02", "DIFFERENCE", "-5", "0", "CHARGED_IN_ANOTHER_MONTH"),
      ];
    },
  });
  const figure = chart(page);
  await expect(figure.getByText("No differences in 2025", { exact: true })).toHaveCount(0);
  await expect(figure.locator(".amount-trend-period")).toHaveCount(2);
  await expect(
    figure.getByRole("list", { name: "Reasons with year totals" }).getByRole("listitem"),
  ).toHaveText(["Charged in another month 0.00 USD"]);
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
]) {
  test(`the chart card keeps its height for an empty year at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const fixture = await openFinancialReview(page);
    const card = chart(page);
    const header = monthsTable(page).locator("thead");
    const filled = await card.boundingBox();
    const tableTop = (await header.boundingBox()).y;
    await page.getByLabel("Marketplace", { exact: true }).selectOption("Amazon.de");
    await expect
      .poll(() => latestRequest(fixture, "financial_review_months").get("p_marketplace"))
      .toBe("Amazon.de");
    const chartEmpty = card.getByText("No differences in 2025", { exact: true });
    await expect(chartEmpty).toBeVisible();
    expect(Math.abs((await card.boundingBox()).height - filled.height)).toBeLessThan(1);
    expect(Math.abs((await header.boundingBox()).y - tableTop)).toBeLessThan(1);
    // Both empty messages share the one EmptyState look.
    const look = (locator) =>
      locator.evaluate((element) => {
        const { color, fontSize, fontWeight } = globalThis.getComputedStyle(element);
        return { color, fontSize, fontWeight };
      });
    expect(await look(chartEmpty)).toEqual(
      await look(page.getByText("No activity in 2025", { exact: true })),
    );
  });
}

test("another month or reason starts its records on page 1", async ({ page }) => {
  const fixture = await openFinancialReview(page, {
    configure(state) {
      state.reviewMonths = [
        reviewMeasure("2025-05", "FINANCES", "-55", "0", null, 55),
        reviewMeasure("2025-05", "DIFFERENCE", "-55", "0", "TOTALS_DIFFER", 55),
        reviewMeasure("2025-06", "FINANCES", "-115", "0", null, 115),
        reviewMeasure("2025-06", "DIFFERENCE", "-55", "0", "TOTALS_DIFFER", 55),
        reviewMeasure("2025-06", "DIFFERENCE", "-60", "0", "NO_ASSIGNMENT", 60),
      ];
      state.reviewOutcomes = [
        ...differenceOutcomes("2025-05", "TOTALS_DIFFER", 55, 100),
        ...differenceOutcomes("2025-06", "TOTALS_DIFFER", 55, 200),
        ...differenceOutcomes("2025-06", "NO_ASSIGNMENT", 60, 300),
      ];
    },
  });
  await page.goto(reviewLink("row=2025-05"));
  const may = reviewDrawer(page, "May 2025");
  await may.getByRole("button", { name: "Next difference records", exact: true }).click();
  await expect(may.getByText("Page 2 · 55 records", { exact: true })).toBeVisible();
  // A reload keeps the open list's page.
  await page.reload();
  await expect(may.getByText("Page 2 · 55 records", { exact: true })).toBeVisible();
  await may.getByRole("button", { name: "Next month", exact: true }).click();
  const june = reviewDrawer(page, "June 2025");
  await expect(june.getByText("Page 1 · 115 records", { exact: true })).toBeVisible();
  expect(latestRequest(fixture, "financial_outcome_page").get("p_offset")).toBe("0");
  // A month seen before starts on page 1 too: no month keeps its own page.
  await june.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(may.getByText("Page 1 · 55 records", { exact: true })).toBeVisible();
  await expect(differenceRecords(may).locator("tbody tr")).toHaveCount(50);
  expect(latestRequest(fixture, "financial_outcome_page").get("p_month")).toBe("2025-05-01");
  expect(latestRequest(fixture, "financial_outcome_page").get("p_offset")).toBe("0");
  await may.getByRole("button", { name: "Next month", exact: true }).click();
  await june.getByRole("button", { name: "Next difference records", exact: true }).click();
  await expect(june.getByText("Page 2 · 115 records", { exact: true })).toBeVisible();
  // So does a month opened again after closing it.
  await june.getByRole("button", { name: "Close June 2025", exact: true }).click();
  await expect(june).toBeHidden();
  await monthsTable(page)
    .getByRole("row", { name: /^June 2025/ })
    .click();
  await expect(june.getByText("Page 1 · 115 records", { exact: true })).toBeVisible();
  await june.getByRole("button", { name: "Next difference records", exact: true }).click();
  await expect(june.getByText("Page 2 · 115 records", { exact: true })).toBeVisible();
  await reasonTable(june)
    .getByRole("row", { name: /Totals differ/ })
    .click();
  await expect(june.getByText("Page 1 · 55 records", { exact: true })).toBeVisible();
  expect(latestRequest(fixture, "financial_outcome_page").get("p_offset")).toBe("0");
  expect(latestRequest(fixture, "financial_outcome_page").get("p_reason")).toBe("TOTALS_DIFFER");
});

test("a linked SelBox group opens its section; collapsing it clears the group", async ({
  page,
}) => {
  await openFinancialReview(page);
  await page.goto(reviewLink("row=2025-01&group=ACCOUNT_FEE"));
  const drawer = reviewDrawer(page, "January 2025");
  const section = drawer.getByRole("button", { name: "SelBox types", exact: true });
  await expect(section).toHaveAttribute("aria-expanded", "true");
  await expect(
    drawer.getByRole("button", { name: "Remove Group: Account fees", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("table", { name: "SelBox type records", exact: true }).locator("tbody tr"),
  ).toHaveCount(1);
  await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "false");
  await expect(page).not.toHaveURL(/group=/);
});

test("a stale month, reason or group in a link leaves the URL", async ({ page }) => {
  await openFinancialReview(page);
  // March has no activity, so nothing opens.
  await page.goto(reviewLink("row=2025-03&reason=ROUNDING"));
  await expect(monthsTable(page).locator("tbody tr")).toHaveCount(3);
  await expect(page).not.toHaveURL(/row=|reason=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // February has no rounding errors or SelBox types: the month opens without them.
  await page.goto(reviewLink("row=2025-02&reason=ROUNDING&group=ACCOUNT_FEE"));
  await expect(reviewDrawer(page, "February 2025")).toBeVisible();
  await expect(page).toHaveURL(/row=2025-02/);
  await expect(page).not.toHaveURL(/reason=|group=/);
});

test("removing the reason by keyboard returns focus to its row", async ({ page }) => {
  await openFinancialReview(page);
  await page.goto(reviewLink("row=2025-01"));
  const drawer = reviewDrawer(page, "January 2025");
  const row = reasonTable(drawer).getByRole("row", { name: /Rounding errors/ });
  for (const control of ["Remove Reason: Rounding errors", "Clear filters"]) {
    await row.focus();
    await page.keyboard.press("Enter");
    const button = drawer.getByRole("button", { name: control, exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute("aria-selected", "false");
  }
});

test("records page 50 at a time with the exact total from the months", async ({ page }) => {
  const fixture = await openFinancialReview(page, {
    configure(state) {
      state.reviewMonths.push(
        reviewMeasure("2025-05", "FINANCES", "-55", "0", null, 55),
        reviewMeasure("2025-05", "DIFFERENCE", "-55", "0", "TOTALS_DIFFER", 55),
      );
      for (let index = 0; index < 55; index += 1)
        state.reviewOutcomes.push(
          reviewOutcome(100 + index, {
            posted_date: "2025-05-20",
            reason: "TOTALS_DIFFER",
            base_amount: "-1",
            tax_amount: "0",
          }),
        );
    },
  });
  await monthsTable(page)
    .getByRole("row", { name: /^May 2025/ })
    .click();
  const drawer = reviewDrawer(page, "May 2025");
  const records = drawer.getByRole("table", { name: "Difference records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(50);
  await expect(drawer.getByText("Page 1 · 55 records", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Next difference records", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(5);
  expect(latestRequest(fixture, "financial_outcome_page").get("p_offset")).toBe("50");
  await expect(drawer.getByText("Page 2 · 55 records", { exact: true })).toBeVisible();
});

test("the page, chart and month drawer pass the accessibility scan", async ({
  page,
  expectAccessible,
}) => {
  await openFinancialReview(page);
  await expectAccessible("financial-review");
  await chart(page)
    .locator('.amount-trend-segment-action[data-period="2025-01"][data-family-id="NO_ASSIGNMENT"]')
    .click();
  const drawer = reviewDrawer(page, "January 2025");
  await drawer.getByRole("button", { name: "SelBox types", exact: true }).click();
  await drawer.getByRole("button", { name: "Payout readiness", exact: true }).click();
  await expect(drawer.getByText("No companies in this scope", { exact: true })).toBeVisible();
  await expectAccessible("financial-review-month");
});
