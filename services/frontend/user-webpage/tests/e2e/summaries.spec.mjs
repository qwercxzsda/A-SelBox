import { skuAssignments } from "./api-fixtures.mjs";
import { liveRow } from "./api-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCards as cards,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

test("daily and previous-month estimates include both sources, stay exact, and ignore search and pagination", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregatePageCap = 1;
  fixture.liveRows = [
    {
      ...liveRow("SALE", 1),
      activity_date: "2026-03-15",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
    {
      ...liveRow("KIOSK", 1),
      activity_date: "2026-03-15",
      source: "DATA_KIOSK",
      source_amount: "50.123456789012345678",
      fee_amount: "-2.5",
      company_amount: "47.623456789012345678",
    },
    {
      ...liveRow("EURO", 1),
      activity_date: "2026-03-15",
      currency: "EUR",
      source_amount: "20",
      fee_amount: "-1",
      company_amount: "19",
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      ...liveRow("OLDER", index + 1),
      activity_date: "2026-03-10",
      source_amount: "1",
      fee_rate_percent: "0",
      fee_amount: "0",
      company_amount: "1",
    })),
    {
      ...liveRow("FEB-FIRST", 1),
      activity_date: "2026-02-03",
      source_amount: "0.123456789012345678",
      fee_amount: "0",
      company_amount: "0.123456789012345678",
    },
    {
      ...liveRow("FEB-LAST", 1),
      activity_date: "2026-02-20",
      source_amount: "0.000000000000000002",
      fee_amount: "-0.000000000000000001",
      company_amount: "0.000000000000000001",
    },
    {
      ...liveRow("FEB-EURO", 1),
      activity_date: "2026-02-20",
      currency: "EUR",
      source_amount: "10",
      fee_amount: "0",
      company_amount: "10",
    },
  ];
  fixture.aggregateRows = [
    summaryBucket("2026-02-03", "0.123456789012345678"),
    summaryBucket("2026-02-20", "10", { currency: "EUR" }),
    summaryBucket("2026-02-20", "0.000000000000000002", {
      serviceFee: "-0.000000000000000001",
      companyAmount: "0.000000000000000001",
    }),
    summaryBucket("2026-03-10", "30", { rowCount: 30 }),
    summaryBucket("2026-03-15", "20", { currency: "EUR", serviceFee: "-1", companyAmount: "19" }),
    summaryBucket("2026-03-15", "150.123456789012345678", {
      serviceFee: "-7.5",
      companyAmount: "142.623456789012345678",
      rowCount: 2,
    }),
  ];
  fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
  await signIn(page);
  const { summaries, day, month } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("150.123456789012345678 USD");
  await expect(amount(day, "Company amount")).toHaveText("142.623456789012345678 USD");
  await expect(amount(month, "Reported amount")).toHaveText("0.12345678901234568 USD");
  await expect(amount(month, "Company amount")).toHaveText("0.123456789012345679 USD");
  await expect(day.getByText("2 records", { exact: true })).toBeVisible();
  await expect(month.getByText("2 records", { exact: true })).toBeVisible();
  for (const bounds of [
    ["gte.2026-03-15", "lte.2026-03-15"],
    ["gte.2026-02-01", "lte.2026-02-28"],
  ]) {
    const completedLoad = fixture.aggregateRequests
      .filter(({ params }) => params.getAll("activity_date").join() === bounds.join())
      .slice(-2);
    expect(completedLoad.map((request) => Number(request.params.get("offset")))).toEqual([0, 1]);
    expect(completedLoad.map((request) => request.includeCount)).toEqual([false, false]);
  }
  for (const request of fixture.latestRequests) {
    expect(request.includeCount).toBe(false);
    expect(request.args).toMatchObject({
      p_limit: 1,
      p_offset: 0,
      p_direction: "desc",
      p_date_from: null,
      p_date_to: null,
      p_sources: [],
      p_types: [],
      p_fee_applicable: null,
      p_include_count: false,
    });
  }
  for (const request of fixture.aggregateRequests) {
    expect(request.params.get("or")).toBeNull();
    expect(request.params.get("sku")).toBeNull();
    expect(request.endpoint).toBe("/rest/v1/rpc/transaction_totals");
    expect(request.args.p_group_by_type).toBe(false);
    expect(request.args.p_currency).toBeNull();
    expect(request.params.getAll("activity_date")).toHaveLength(2);
    expect(request.params.get("and")).toBe("(or(source.neq.DATA_KIOSK,source_amount.neq.0))");
  }
  const summaryRequestCount = fixture.aggregateRequests.length;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("SALE");
  await expect(
    page.getByRole("table", { name: "Financial records", exact: true }).getByRole("row"),
  ).toHaveCount(2);
  await expect(amount(day, "Reported amount")).toHaveText("150.123456789012345678 USD");
  await expect(amount(month, "Reported amount")).toHaveText("0.12345678901234568 USD");
  expect(fixture.aggregateRequests).toHaveLength(summaryRequestCount);
  await summaries.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await expect(amount(day, "Reported amount")).toHaveText("20 EUR");
  await expect(amount(month, "Reported amount")).toHaveText("10 EUR");
  await expect(day).not.toContainText("150.123456789012345678 USD");
  await expect(month).not.toContainText("0.12345678901234568 USD");
});

test("a leap-year month-end latest date selects that same month despite gaps in activity", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2024-01-31", "500"),
    summaryBucket("2024-02-01", "10"),
    summaryBucket("2024-02-29", "20", { serviceFee: "-1", companyAmount: "19" }),
  ];
  await signIn(page);
  const { summaries, day, month } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("20 USD");
  await expect(amount(month, "Reported amount")).toHaveText("30 USD");
  await expect(amount(month, "Company amount")).toHaveText("29 USD");
  await expect(month.getByText("2 records", { exact: true })).toBeVisible();
  await expect(summaries.getByLabel("Currency", { exact: true })).toHaveCount(0);
});

test("a selected previous month without activity is empty rather than falling back to an older month", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [summaryBucket("2026-04-30", "999"), summaryBucket("2026-06-12", "10")];
  await signIn(page);
  const { day, month } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("10 USD");
  await expect(month).toContainText(/May|2026-05|05\/2026/);
  await expect(month).toContainText(/No transactions/);
  await expect(month).not.toContainText("999 USD");
});

for (const known of [true, false]) {
  test(`${known ? "partially known" : "unknown"} company totals retain missing-amount warnings`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [
      summaryBucket("2026-05-31", "300", {
        serviceFee: known ? "-5" : null,
        companyAmount: known ? "95" : null,
        rowCount: known ? 3 : 2,
        knownCompanyCount: known ? 1 : 0,
      }),
    ];
    await signIn(page);
    const { day, month, selected } = cards(page);
    await day.getByRole("button", { name: /^Filter transactions to / }).click();
    for (const card of [day, month, selected]) {
      await expect(amount(card, "Reported amount")).toHaveText("300 USD");
      await expect(amount(card, "Known company amount")).toHaveText(known ? "95 USD" : "—");
      await expect(amount(card, "Service fee")).toHaveText(known ? "-5 USD" : "—");
      await expect(card).toContainText("2 transactions have uncalculated amounts.");
    }
  });
}

test("changing account and role clears estimates and the selected currency before new totals arrive", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-b"] = "operator";
  fixture.aggregateRowsByUser = {
    "member-a": [
      summaryBucket("2026-03-15", "7", { currency: "EUR" }),
      summaryBucket("2026-03-15", "42"),
    ],
    "member-b": [summaryBucket("2026-03-15", "907")],
  };
  await signIn(page);
  const { summaries, day, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("42 USD");
  await summaries.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await expect(amount(day, "Reported amount")).toHaveText("7 EUR");
  await applyDates(page, "2026-03-15", "2026-03-15");
  await expect(amount(selected, "Reported amount")).toHaveText("7 EUR");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const started = deferred();
  const release = deferred();
  fixture.beforeAggregates = async ({ user }) => {
    if (user === "member-b") {
      started.resolve();
      await release.promise;
    }
  };
  await signIn(page, "member-b");
  await started.promise;
  await expect(summaries).not.toContainText("7 EUR");
  await expect(summaries).not.toContainText("42 USD");
  release.resolve();
  await expect(amount(day, "Reported amount")).toHaveText("907 USD");
  await expect(summaries.getByLabel("Currency", { exact: true })).toHaveCount(0);
  await expect(selected).toContainText("Select a date range to see totals.");
  await expect(amount(selected, "Reported amount")).toHaveCount(0);
});

test("latest-date errors leave transactions usable and Retry summaries can recover", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.latestStatus = 403;
  fixture.aggregateRows = [summaryBucket("2026-03-15", "10")];
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const { summaries, day } = cards(page);
  await expect(summaries.getByRole("alert")).toContainText("HTTP 403");
  expect(fixture.aggregateRequests).toHaveLength(0);
  fixture.latestStatus = 200;
  await summaries.getByRole("button", { name: "Retry summaries", exact: true }).click();
  await expect(amount(day, "Reported amount")).toHaveText("10 USD");
  await expect(summaries.getByRole("alert")).toHaveCount(0);
});
