import { liveRow, skuAssignment } from "./api-fixtures.mjs";
import { applyDates, columnTrigger } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn, waitForRequestSettled } from "./fixtures.mjs";
import { filterRecordRows } from "./record-fixtures.mjs";
import { periodBucketTotals } from "./aggregate-fixtures.mjs";
import {
  summaryAmount as amount,
  summaryBucket,
  summaryCard,
  summaryPeriods as totals,
} from "./summary-fixtures.mjs";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const SKUS = ["ALPHA", "BETA", "GAMMA"];
const MARKETPLACES = ["Amazon.com", "Amazon.co.jp"];
const skuScope = (...skus) => `in.(${[...new Set(skus)].sort().map(JSON.stringify).join(",")})`;
const companyScope = (id) => `in.(${id})`;

async function skuFixture(page, role = "member") {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds = { "member-a": COMPANY_A, "member-b": COMPANY_B };
  fixture.companyNames = { [COMPANY_A]: "Company A", [COMPANY_B]: "Company B" };
  fixture.assignments = SKUS.map((sku, index) => ({
    ...skuAssignment(index + 1),
    sku,
    company_id: COMPANY_A,
  }));
  const bucket = (companyId, sku, date, value, options) => ({
    ...summaryBucket(date, value, options),
    company_id: companyId,
    sku,
    component_type: "PRODUCT_SALES",
    source: date === "2026-02-28" ? "DATA_KIOSK" : "FINANCES",
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
    bucket(COMPANY_A, "GAMMA", "2026-05-11", "0"),
    bucket(COMPANY_B, "ALPHA", "2026-02-05", "40"),
    bucket(COMPANY_B, "ALPHA", "2026-03-31", "900"),
    bucket(COMPANY_B, "BETA", "2026-05-05", "50"),
    bucket(COMPANY_B, "BETA", "2026-06-15", "1000"),
    bucket(COMPANY_B, "BETA", "2026-06-16", "0"),
  ];
  if (role === "member") {
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
  await columnTrigger(page, label).click();
  const menu = page.getByRole("dialog", { name: `${label} options`, exact: true });
  if (values.length === 0) {
    await menu.getByRole("button", { name: `Clear ${label.toLowerCase()}`, exact: true }).click();
  } else {
    for (const name of choices) {
      if (label === "Type") await menu.getByLabel("Search type", { exact: true }).fill(name);
      await menu.getByRole("checkbox", { name, exact: true }).setChecked(values.includes(name));
    }
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
}

async function expectTotal(page, period, marketplace, field, expected) {
  const key = { "Last day": "day", "Last month": "month", "Selected dates": "selected" }[period];
  await expect(amount(totals(page, marketplace)[key], field)).toHaveText(expected);
}

async function openSelectedBreakdown(page, expected, marketplace = "Amazon.com") {
  await totals(page, marketplace)
    .selected.getByRole("button", {
      name: `View Selected dates for ${marketplace} in USD by type`,
      exact: false,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  await expect(
    amount(dialog.getByRole("region", { name: "Breakdown total", exact: true }), "Reported amount"),
  ).toHaveText(expected);
  await dialog.getByRole("button", { name: "Sales & refunds details", exact: true }).click();
  await expect(
    dialog.getByRole(page.viewportSize().width < 720 ? "article" : "row", {
      name: "Product sales amounts",
      exact: true,
    }),
  ).toContainText(expected);
  return dialog;
}

async function expectEmpty(page, period, marketplace = "Amazon.com") {
  const key = { "Last day": "day", "Last month": "month", "Selected dates": "selected" }[period];
  await expect(totals(page, marketplace)[key]).toContainText("No transactions");
  await expect(totals(page, marketplace)[key].locator("[data-amount-field]")).toHaveCount(0);
}

async function expectAnchors(page, day, month) {
  await expect(
    summaryCard(page, "Last day").getByRole("button", {
      name: `Filter transactions to ${day} · UTC`,
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    summaryCard(page, "Last month").getByRole("button", {
      name: `Filter transactions to ${month} · UTC`,
      exact: true,
    }),
  ).toHaveCount(1);
}

function expectUnfilteredDiscovery(fixture, count = 1) {
  expect(fixture.latestRequests).toHaveLength(count);
  for (const { args } of fixture.latestRequests) {
    expect(args).toMatchObject({
      p_limit: 1,
      p_include_count: false,
      p_company_ids: [],
      p_skus: [],
      p_marketplaces: [],
      p_sources: [],
      p_types: [],
      p_date_from: null,
      p_date_to: null,
    });
  }
}

test("member totals, type breakdowns and records intersect every selected filter while dates only change the selected period", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  const refund = {
    ...fixture.aggregateRows[1],
    activity_date: "2026-02-18",
    component_type: "PRODUCT_REFUNDS",
    source_amount: "-2",
    reported_amount: "-2",
    company_amount: "-2",
  };
  fixture.aggregateRows.push(refund);
  fixture.aggregateRowsByUser["member-a"].push(refund);
  fixture.liveRows.push({ ...liveRow("SKU", 100, COMPANY_A), ...refund });
  await signIn(page);
  await totals(page).summaries.waitFor();
  await expectAnchors(page, "May 10, 2026", "April 2026");
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "700.00 USD");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "300.00 USD");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "13.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "127.12 USD");
  await applyDates(page, "2026-02-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "8.00 USD");
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "700.00 USD");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "300.00 USD");

  await selectValues(page, "SKU", ["ALPHA", "BETA"]);
  await expectEmpty(page, "Last day");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "300.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "120.12 USD");
  await selectValues(page, "Source", ["Finances"], ["Finances", "Data Kiosk"]);
  await expectEmpty(page, "Selected dates", "Amazon.co.jp");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "8.00 USD");
  await selectValues(page, "Type", ["Product sales"], ["Product sales"]);
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "10.00 USD");
  await page.getByLabel("Search", { exact: true }).fill("ALPHA");
  await expectEmpty(page, "Last month");
  await selectValues(page, "Service fee", ["Not applicable"], ["Applicable", "Not applicable"]);
  await expectEmpty(page, "Selected dates");
  await selectValues(page, "Service fee", ["Applicable"], ["Applicable", "Not applicable"]);
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "10.00 USD");

  const scope = {
    p_company_ids: [],
    p_skus: ["ALPHA", "BETA"],
    p_sources: ["FINANCES"],
    p_types: ["PRODUCT_SALES"],
    p_fee_applicable: true,
    p_search_skus: ["ALPHA"],
    p_search_types: [],
    p_search_marketplaces: [],
    p_search_sources: [],
  };
  const periods = fixture.aggregateRequests.filter(
    ({ args }) => args.p_fee_applicable === true && args.p_search_skus?.includes("ALPHA"),
  );
  expect(periods.map(({ args }) => [args.p_date_from, args.p_date_to])).toEqual(
    expect.arrayContaining([
      ["2026-05-10", "2026-05-10"],
      ["2026-04-01", "2026-04-30"],
      ["2026-02-01", "2026-02-28"],
    ]),
  );
  for (const { args } of periods) expect(args).toMatchObject(scope);

  const dialog = await openSelectedBreakdown(page, "10.00 USD");
  const detailScope = {
    ...scope,
    p_marketplaces: ["Amazon.com"],
    p_date_from: "2026-02-01",
    p_date_to: "2026-02-28",
    p_currency: "USD",
  };
  expect(fixture.breakdownRequests.at(-1).args).toMatchObject(detailScope);
  const drawerFilters = dialog.getByRole("region", { name: "Applied filters", exact: true });
  for (const value of ["ALPHA", "BETA", "Amazon.com", "Finances", "Product sales", "Applicable"])
    await expect(drawerFilters).toContainText(value);
  const records = dialog.getByRole("table", { name: "Amount records", exact: true });
  await expect(records.locator("tbody tr")).toHaveCount(1);
  await expect(records).toContainText("ALPHA");
  const recordRequest = () => fixture.summaryRecordRequests.at(-1);
  expect(recordRequest().args).toMatchObject(detailScope);
  await dialog.getByRole("button", { name: "View Product sales records", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(1);
  expect(recordRequest().args).toMatchObject(detailScope);
  await dialog.getByRole("button", { name: "Show all records", exact: true }).click();
  await expect(records.locator("tbody tr")).toHaveCount(1);
  expect(recordRequest().args).toMatchObject(detailScope);
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();

  await page.getByLabel("Search", { exact: true }).fill("NO MATCH");
  await expect(page.getByText("No matching records", { exact: true })).toBeVisible();
  await expectEmpty(page, "Selected dates");
  await expectEmpty(page, "Last day");
  await expectEmpty(page, "Last month");
  await expectAnchors(page, "May 10, 2026", "April 2026");
  expectUnfilteredDiscovery(fixture);
});

test("administrator company, SKU, marketplace and date filters intersect without changing the global UTC anchor", async ({
  page,
}, testInfo) => {
  const fixture = await skuFixture(page, "administrator");
  await signIn(page);
  await expectAnchors(page, "Jun 15, 2026", "May 2026");
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "1,000.00 USD");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "750.00 USD");
  await selectValues(page, "SKU", ["ALPHA"]);
  await selectValues(page, "Company", ["Company A"], ["Company A", "Company B"]);
  await expectEmpty(page, "Last day");
  await expectEmpty(page, "Last month");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "100.12 USD");
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "15.00 USD");
  await expectAnchors(page, "Jun 15, 2026", "May 2026");
  const dialog = await openSelectedBreakdown(page, "15.00 USD");
  for (const { params } of [fixture.aggregateRequests.at(-1), fixture.breakdownRequests.at(-1)]) {
    expect(params.get("sku")).toBe(skuScope("ALPHA"));
    expect(params.get("company_id")).toBe(companyScope(COMPANY_A));
    expect(params.get("marketplace_name")).toBe(skuScope("Amazon.com"));
  }
  const drawerFilters = dialog.getByRole("region", { name: "Applied filters", exact: true });
  for (const value of ["Company A", "ALPHA", "Amazon.com"])
    await expect(drawerFilters).toContainText(value);
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await applyDates(page, "2026-02-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "10.00 USD");
  await selectValues(page, "SKU", []);
  await expectEmpty(page, "Last day");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "700.00 USD");
  await selectValues(page, "Company", ["Company B"], ["Company A", "Company B"]);
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "1,000.00 USD");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "50.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "40.00 USD");
  await expectAnchors(page, "Jun 15, 2026", "May 2026");
  expectUnfilteredDiscovery(fixture);
  await totals(page).summaries.screenshot({
    path: testInfo.outputPath("administrator-shared-periods.png"),
    animations: "disabled",
  });
});

test("marketplace selections keep one fixed UTC period while selected totals and breakdowns follow their scope on mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const fixture = await skuFixture(page);
  await signIn(page);
  await selectValues(page, "SKU", ["ALPHA"]);
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  await expectEmpty(page, "Last day");
  await expectEmpty(page, "Last month");
  await selectValues(page, "Marketplace", MARKETPLACES, MARKETPLACES);
  await expectEmpty(page, "Last day", "Amazon.co.jp");
  await expectAnchors(page, "May 10, 2026", "April 2026");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.com", "Reported amount", "15.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "100.12 USD");
  const dialog = await openSelectedBreakdown(page, "100.12 USD", "Amazon.co.jp");
  expect(fixture.breakdownRequests.at(-1).args).toMatchObject({
    p_skus: ["ALPHA"],
    p_marketplaces: ["Amazon.co.jp"],
    p_company_ids: [],
  });
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await selectValues(page, "Marketplace", [], MARKETPLACES);
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "100.12 USD");
  await expectAnchors(page, "May 10, 2026", "April 2026");
  expectUnfilteredDiscovery(fixture);
  await totals(page).summaries.screenshot({
    path: testInfo.outputPath("mobile-shared-periods.png"),
    animations: "disabled",
  });
});

test("late SKU totals cannot replace the current scope and cached selections reuse amounts without rediscovering dates", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  await signIn(page);
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "700.00 USD");
  await applyDates(page, "2026-01-01", "2026-02-28");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "127.12 USD");
  const started = deferred();
  const release = deferred();
  fixture.beforeAggregates = async ({ params }) => {
    if (params.get("sku") === skuScope("ALPHA")) {
      started.resolve();
      await release.promise;
    }
  };
  const olderSettled = waitForRequestSettled(page, (request) => {
    if (new URL(request.url()).pathname !== "/rest/v1/rpc/transaction_totals") return false;
    const args = request.postDataJSON();
    return args.p_skus.length === 1 && args.p_skus[0] === "ALPHA";
  });
  await selectValues(page, "SKU", ["ALPHA"]);
  await started.promise;
  await expect(totals(page).summaries).toHaveAttribute("aria-busy", "true");
  await expect(totals(page).day).not.toContainText("700.00 USD");
  await selectValues(page, "SKU", ["BETA"]);
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "300.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "20.00 USD");
  release.resolve();
  await olderSettled;
  await expectEmpty(page, "Last day");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "20.00 USD");
  await selectValues(page, "SKU", ["ALPHA"]);
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "100.12 USD");
  await expectEmpty(page, "Last month");
  const aggregateCount = fixture.aggregateRequests.length;
  await selectValues(page, "SKU", ["BETA"]);
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "300.00 USD");
  await expectTotal(page, "Selected dates", "Amazon.co.jp", "Reported amount", "20.00 USD");
  expect(fixture.aggregateRequests).toHaveLength(aggregateCount);
  expectUnfilteredDiscovery(fixture);
});

test("signing into another member changes the access-scoped anchor and clears UI filters and caches", async ({
  page,
}) => {
  const fixture = await skuFixture(page);
  await signIn(page);
  await expectAnchors(page, "May 10, 2026", "April 2026");
  await selectValues(page, "SKU", ["ALPHA"]);
  await selectValues(page, "Marketplace", ["Amazon.com"], MARKETPLACES);
  await applyDates(page, "2026-01-01", "2026-02-28");
  const dialog = await openSelectedBreakdown(page, "15.00 USD");
  await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  fixture.liveRows = fixture.aggregateRowsByUser["member-b"].map((row, index) => ({
    ...liveRow("BRAVO", index + 1, COMPANY_B),
    ...row,
  }));
  fixture.assignments = ["ALPHA", "BETA"].map((sku, index) => ({
    ...skuAssignment(index + 1),
    sku,
    company_id: COMPANY_B,
  }));
  await signIn(page, "member-b");
  await expectAnchors(page, "Jun 15, 2026", "May 2026");
  await expectTotal(page, "Last day", "Amazon.com", "Reported amount", "1,000.00 USD");
  await expectTotal(page, "Last month", "Amazon.com", "Reported amount", "50.00 USD");
  await expect(totals(page).selected).toContainText("Choose dates");
  await expect(
    totals(page).summaries.getByRole("region", { name: "Applied filters", exact: true }),
  ).toHaveCount(0);
  await totals(page)
    .day.getByRole("button", { name: "View Last day for Amazon.com in USD by type", exact: false })
    .click();
  await expect(
    amount(page.getByRole("region", { name: "Breakdown total", exact: true }), "Reported amount"),
  ).toHaveText("1,000.00 USD");
  expect(fixture.latestRequests.filter(({ user }) => user === "member-b")).toHaveLength(1);
  expect(fixture.latestRequests.at(-1).args).toMatchObject({
    p_skus: [],
    p_marketplaces: [],
    p_company_ids: [],
  });
  expect(fixture.breakdownRequests.at(-1).args.p_marketplaces).toEqual(["Amazon.com"]);
});
