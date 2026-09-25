import { liveRow } from "./api-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn, waitForRequestSettled } from "./fixtures.mjs";
import { filterRecordRows } from "./record-fixtures.mjs";
import { periodBucketTotals } from "./aggregate-fixtures.mjs";
import {
  summaryAmount as amount,
  summaryBucket,
  summaryCards as cards,
} from "./summary-fixtures.mjs";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const SKUS = ["ALPHA", "BETA", "GAMMA"];
const MARKETPLACES = ["Amazon.com", "Amazon.co.jp"];
const skuScope = (...skus) => `in.(${[...new Set(skus)].sort().map(JSON.stringify).join(",")})`;
const companyScope = (id) => `in.(${id})`;

async function skuFixture(page, role = "company_member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds = { "member-a": COMPANY_A, "member-b": COMPANY_B };
  fixture.companyNames = { [COMPANY_A]: "Company A", [COMPANY_B]: "Company B" };
  const bucket = (companyId, sku, date, value, options) => ({
    ...summaryBucket(date, value, options),
    company_id: companyId,
    sku,
    component_type: "PRODUCT_SALES",
    source: date === "2026-02-28" ? "DATA_KIOSK" : "SETTLEMENT",
    marketplace_name: date === "2026-02-28" ? "Amazon.co.jp" : "Amazon.com",
    source_amount: value,
  });
  fixture.aggregateRows = [
    bucket(COMPANY_A, "ALPHA", "2026-01-10", "5"),
    bucket(COMPANY_A, "ALPHA", "2026-02-05", "10"),
    bucket(COMPANY_A, "ALPHA", "2026-02-28", "100.123456789012345678", {
      serviceFee: "-5.123456789012345678",
      companyAmount: "95",
    }),
    bucket(COMPANY_A, "BETA", "2026-02-28", "20"),
    bucket(COMPANY_A, "BETA", "2026-03-05", "200"),
    bucket(COMPANY_A, "BETA", "2026-04-20", "300"),
    bucket(COMPANY_A, "GAMMA", "2026-02-28", "7"),
    bucket(COMPANY_A, "GAMMA", "2026-05-10", "700"),
    bucket(COMPANY_B, "ALPHA", "2026-02-05", "40"),
    bucket(COMPANY_B, "ALPHA", "2026-03-31", "900"),
    bucket(COMPANY_B, "BETA", "2026-05-05", "50"),
    bucket(COMPANY_B, "BETA", "2026-06-15", "1000"),
  ];
  if (role === "company_member") {
    fixture.aggregateRowsByUser["member-a"] = fixture.aggregateRows.filter(
      (row) => row.company_id === COMPANY_A,
    );
  }
  fixture.aggregateRowsByUser["member-b"] = fixture.aggregateRows.filter(
    (row) => row.company_id === COMPANY_B,
  );
  fixture.breakdownRowsForRequest = ({ user, params }) => {
    const rows = filterRecordRows(
      fixture.aggregateRowsByUser[user] ?? fixture.aggregateRows,
      params,
    );
    return periodBucketTotals(rows, params).map((row) => ({
      ...row,
      component_type: "PRODUCT_SALES",
    }));
  };
  const datasetRows = fixture.aggregateRowsByUser["member-a"] ?? fixture.aggregateRows;
  fixture.liveRows = datasetRows.map((row, index) => ({
    ...liveRow("SKU", index + 1, row.company_id),
    ...row,
  }));
  return fixture;
}

async function selectValues(page, label, values, choices = SKUS) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const menu = page.getByRole("dialog", { name: `${label} options`, exact: true });
  if (values.length === 0) {
    await menu.getByRole("button", { name: `Clear ${label.toLowerCase()}`, exact: true }).click();
  } else {
    for (const name of choices) {
      await menu.getByRole("checkbox", { name, exact: true }).setChecked(values.includes(name));
    }
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

async function openSelectedBreakdown(page, expected) {
  await page.getByRole("button", { name: "View Selected dates by type", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
  await expect(
    amount(dialog.getByRole("region", { name: "Breakdown total", exact: true }), "Reported amount"),
  ).toHaveText(expected);
  await dialog.getByRole("button", { name: "Sales and refunds details", exact: true }).click();
  await expect(
    dialog.getByRole(page.viewportSize().width < 720 ? "article" : "row", {
      name: "Product sales amounts",
      exact: true,
    }),
  ).toContainText(expected);
  return dialog;
}

test("member SKU selections scope all cards and raw breakdowns while unrelated table filters stay independent", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("700 USD");
  await expect(amount(month, "Reported amount")).toHaveText("300 USD");
  await selectValues(page, "SKU", ["ALPHA"]);
  await expect(amount(day, "Reported amount")).toHaveText("100.123456789012345678 USD");
  await expect(amount(month, "Reported amount")).toHaveText("110.123456789012345678 USD");
  await expect(amount(month, "Company amount")).toHaveText("105 USD");
  const activeFilters = cards(page).summaries.getByRole("region", {
    name: "Applied filters",
    exact: true,
  });
  await expect(activeFilters).toContainText("SKU");
  await expect(activeFilters).toContainText("ALPHA");
  await expect(cards(page).summaries.getByText("Estimated", { exact: true })).toHaveCount(0);
  await expect(selected).toContainText("Select a date range to see totals.");
  expect(fixture.latestRequests.at(-1).params.get("sku")).toBe(skuScope("ALPHA"));
  const periods = fixture.aggregateRequests.filter(
    ({ params }) => params.get("sku") === skuScope("ALPHA"),
  );
  expect(periods.map(({ params }) => params.getAll("activity_date"))).toEqual([
    ["gte.2026-02-28", "lte.2026-02-28"],
    ["gte.2026-02-01", "lte.2026-02-28"],
  ]);
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  const summaryRequests = fixture.aggregateRequests.length;
  await selectValues(page, "Source", ["Settlements"], ["Settlements", "Data Kiosk"]);
  await selectValues(page, "Type", ["Product sales"], ["Product sales"]);
  await page.getByLabel("Search", { exact: true }).fill("NO MATCH");
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reported amount", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Reported amount options", exact: true })
    .getByRole("button", { name: "Highest first", exact: true })
    .click();
  await expect(amount(day, "Reported amount")).toHaveText("100.123456789012345678 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  expect(fixture.aggregateRequests).toHaveLength(summaryRequests);
  const dialog = await openSelectedBreakdown(page, "115.123456789012345678 USD");
  await expect(dialog.getByRole("region", { name: "Applied filters", exact: true })).toContainText(
    "ALPHA",
  );
  await expect(dialog.getByText(/^Dates: /)).toBeVisible();
  const params = fixture.breakdownRequests.at(-1).params;
  expect(params.get("sku")).toBe(skuScope("ALPHA"));
  expect(params.get("company_id")).toBeNull();
  expect(params.get("source")).toBeNull();
  expect(params.get("or")).toBeNull();
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await selectValues(page, "SKU", ["ALPHA", "BETA"]);
  await expect(amount(day, "Reported amount")).toHaveText("300 USD");
  await expect(amount(month, "Reported amount")).toHaveText("200 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("135.123456789012345678 USD");
  expect(fixture.latestRequests.at(-1).params.get("sku")).toBe(skuScope("ALPHA", "BETA"));
  await openSelectedBreakdown(page, "135.123456789012345678 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("sku")).toBe(skuScope("ALPHA", "BETA"));
});

test("administrator company, SKU, and marketplace selections intersect while DATE changes only selected totals", async ({
  page,
}, testInfo) => {
  const fixture = await skuFixture(page, "operator");
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("1,000 USD");
  await selectValues(page, "SKU", ["ALPHA"]);
  await expect(amount(day, "Reported amount")).toHaveText("900 USD");
  await expect(amount(month, "Reported amount")).toHaveText("900 USD");
  await selectValues(page, "Company", ["Company A"], ["Company A", "Company B"]);
  await expect(amount(day, "Reported amount")).toHaveText("100.123456789012345678 USD");
  await expect(amount(month, "Reported amount")).toHaveText("110.123456789012345678 USD");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  await expect(amount(day, "Reported amount")).toHaveText("10 USD");
  await expect(amount(month, "Reported amount")).toHaveText("5 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("15 USD");
  const summaryFilters = cards(page).summaries.getByRole("region", {
    name: "Applied filters",
    exact: true,
  });
  for (const value of ["Company A", "ALPHA", "Amazon.com"]) {
    await expect(summaryFilters).toContainText(value);
  }
  await cards(page).summaries.screenshot({
    path: testInfo.outputPath("operator-summary-filters.png"),
    animations: "disabled",
  });
  const dialog = await openSelectedBreakdown(page, "15 USD");
  for (const request of [
    fixture.latestRequests.at(-1),
    fixture.aggregateRequests.at(-1),
    fixture.breakdownRequests.at(-1),
  ]) {
    expect(request.params.get("sku")).toBe(skuScope("ALPHA"));
    expect(request.params.get("company_id")).toBe(companyScope(COMPANY_A));
    expect(request.params.get("marketplace_name")).toBe(skuScope("Amazon.com"));
  }
  const drawerFilters = dialog.getByRole("region", { name: "Applied filters", exact: true });
  for (const value of ["Company A", "ALPHA", "Amazon.com"]) {
    await expect(drawerFilters).toContainText(value);
  }
  await dialog
    .getByRole("region", { name: "Applied filters", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("operator-drawer-filters.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  const latestCount = fixture.latestRequests.length;
  const aggregateCount = fixture.aggregateRequests.length;
  await applyDates(page, "2026-02-01", "2026-02-28");
  await expect(amount(selected, "Reported amount")).toHaveText("10 USD");
  await expect(amount(day, "Reported amount")).toHaveText("10 USD");
  await expect(amount(month, "Reported amount")).toHaveText("5 USD");
  expect(fixture.latestRequests).toHaveLength(latestCount);
  expect(fixture.aggregateRequests).toHaveLength(aggregateCount + 1);
  expect(fixture.aggregateRequests.at(-1).params.getAll("activity_date")).toEqual([
    "gte.2026-02-01",
    "lte.2026-02-28",
  ]);
  await selectValues(page, "SKU", []);
  await expect(amount(day, "Reported amount")).toHaveText("700 USD");
  await expect(amount(month, "Reported amount")).toHaveText("300 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("10 USD");
  for (const request of [fixture.latestRequests.at(-1), fixture.aggregateRequests.at(-1)]) {
    expect(request.params.get("sku")).toBeNull();
    expect(request.params.get("company_id")).toBe(companyScope(COMPANY_A));
    expect(request.params.get("marketplace_name")).toBe(skuScope("Amazon.com"));
  }
  const allSku = await openSelectedBreakdown(page, "10 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("sku")).toBeNull();
  expect(fixture.breakdownRequests.at(-1).params.get("company_id")).toBe(companyScope(COMPANY_A));
  expect(fixture.breakdownRequests.at(-1).params.get("marketplace_name")).toBe(
    skuScope("Amazon.com"),
  );
  await allSku.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await page.getByRole("button", { name: "Company", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Company options", exact: true })
      .getByRole("checkbox", { name: "Company A", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("dialog", { name: "Company options", exact: true })
    .getByRole("button", { name: "Close options", exact: true })
    .click();
  await selectValues(page, "Marketplace", ["Amazon.co.jp"], MARKETPLACES);
  await selectValues(page, "Company", ["Company B"], ["Company A", "Company B"]);
  await expect(day).toContainText("No transactions match these filters.");
  await expect(day.locator("dl")).toHaveCount(0);
  await expect(
    day.getByRole("button", { name: "View Latest day by type", exact: true }),
  ).toHaveCount(0);
  await expect(
    month.getByRole("button", { name: "View Latest month by type", exact: true }),
  ).toHaveCount(0);
});

test("member marketplace checkboxes combine as alternatives within the selected SKU scope", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const fixture = await skuFixture(page);
  await signIn(page);
  await selectValues(page, "SKU", ["ALPHA"]);
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("10 USD");
  await expect(amount(month, "Reported amount")).toHaveText("5 USD");
  expect(fixture.latestRequests.at(-1).params.get("marketplace_name")).toBe(skuScope("Amazon.com"));
  await selectValues(page, "Marketplace", MARKETPLACES, MARKETPLACES);
  await expect(amount(day, "Reported amount")).toHaveText("100.123456789012345678 USD");
  await expect(amount(month, "Reported amount")).toHaveText("110.123456789012345678 USD");
  expect(fixture.latestRequests.at(-1).params.get("marketplace_name")).toBe(
    skuScope(...MARKETPLACES),
  );
  expect(fixture.latestRequests.at(-1).params.get("sku")).toBe(skuScope("ALPHA"));
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  await cards(page).summaries.screenshot({
    path: testInfo.outputPath("member-mobile-summary-filters.png"),
    animations: "disabled",
  });
  const dialog = await openSelectedBreakdown(page, "115.123456789012345678 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("marketplace_name")).toBe(
    skuScope(...MARKETPLACES),
  );
  expect(fixture.breakdownRequests.at(-1).params.get("company_id")).toBeNull();
  await dialog
    .getByRole("region", { name: "Applied filters", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("member-mobile-drawer-filters.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await selectValues(page, "Marketplace", [], MARKETPLACES);
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  const filters = cards(page).summaries.getByRole("region", {
    name: "Applied filters",
    exact: true,
  });
  await expect(filters).toContainText("ALPHA");
  await expect(filters).not.toContainText("Marketplace");
  const unscoped = fixture.aggregateRequests.filter(
    ({ params }) =>
      params.get("sku") === skuScope("ALPHA") && params.get("marketplace_name") === null,
  );
  expect(unscoped.length).toBeGreaterThan(0);
});

test("late SKU responses cannot show previous totals and cached SKU selections reuse their own scope", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  await signIn(page);
  const { day, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("700 USD");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expect(amount(selected, "Reported amount")).toHaveText("142.123456789012345678 USD");
  const started = deferred();
  const release = deferred();
  fixture.beforeLatest = fixture.beforeAggregates = async ({ params }) => {
    if (params.get("sku") === skuScope("ALPHA")) {
      started.resolve();
      await release.promise;
    }
  };
  const olderSettled = waitForRequestSettled(page, (request) => {
    if (new URL(request.url()).pathname !== "/rest/v1/rpc/transaction_page") return false;
    const args = request.postDataJSON();
    return (
      args.p_limit === 1 &&
      args.p_include_count === false &&
      args.p_skus.length === 1 &&
      args.p_skus[0] === "ALPHA"
    );
  });
  await selectValues(page, "SKU", ["ALPHA"]);
  await started.promise;
  await expect(
    day.getByRole("status", { name: "Loading latest day totals", exact: true }),
  ).toBeVisible();
  await expect(
    selected.getByRole("status", { name: "Loading selected dates totals", exact: true }),
  ).toBeVisible();
  await expect(day).not.toContainText("700 USD");
  await expect(selected).not.toContainText("142.123456789012345678 USD");
  await selectValues(page, "SKU", ["BETA"]);
  await expect(amount(day, "Reported amount")).toHaveText("300 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("20 USD");
  release.resolve();
  await olderSettled;
  await selected.evaluate(
    (element) =>
      new Promise((resolve) =>
        element.ownerDocument.defaultView.requestAnimationFrame(() => resolve()),
      ),
  );
  await expect(amount(day, "Reported amount")).toHaveText("300 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("20 USD");
  await selectValues(page, "SKU", ["ALPHA"]);
  await expect(amount(day, "Reported amount")).toHaveText("100.123456789012345678 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("115.123456789012345678 USD");
  const latestCount = fixture.latestRequests.length;
  const aggregateCount = fixture.aggregateRequests.length;
  await selectValues(page, "SKU", ["BETA"]);
  await expect(amount(day, "Reported amount")).toHaveText("300 USD");
  await expect(amount(selected, "Reported amount")).toHaveText("20 USD");
  expect(fixture.latestRequests).toHaveLength(latestCount);
  expect(fixture.aggregateRequests).toHaveLength(aggregateCount);
});

test("signing into another member clears SKU and marketplace selections and their summary caches", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  await signIn(page);
  await selectValues(page, "SKU", ["ALPHA"]);
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  await applyDates(page, "2026-01-01", "2026-02-28");
  const dialog = await openSelectedBreakdown(page, "15 USD");
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  fixture.liveRows = fixture.aggregateRowsByUser["member-b"].map((row, index) => ({
    ...liveRow("BRAVO", index + 1, COMPANY_B),
    ...row,
  }));
  await signIn(page, "member-b");
  await expect(amount(cards(page).day, "Reported amount")).toHaveText("1,000 USD");
  await expect(amount(cards(page).month, "Reported amount")).toHaveText("50 USD");
  await expect(cards(page).selected).toContainText("Select a date range to see totals.");
  await expect(
    cards(page).summaries.getByRole("region", { name: "Applied filters", exact: true }),
  ).toHaveText("All transactions");
  await page.getByRole("button", { name: "SKU", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "SKU options", exact: true });
  await expect(menu.getByRole("checkbox", { name: "ALPHA", exact: true })).not.toBeChecked();
  await expect(menu.getByRole("checkbox", { name: "BETA", exact: true })).not.toBeChecked();
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await page.getByRole("button", { name: "View Latest day by type", exact: true }).click();
  await expect(
    amount(page.getByRole("region", { name: "Breakdown total", exact: true }), "Reported amount"),
  ).toHaveText("1,000 USD");
  for (const request of [
    ...fixture.latestRequests,
    ...fixture.aggregateRequests,
    ...fixture.breakdownRequests,
  ].filter(({ user }) => user === "member-b")) {
    expect(request.params.get("sku")).toBeNull();
    expect(request.params.get("marketplace_name")).toBeNull();
  }
});
