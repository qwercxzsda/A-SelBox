import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCard,
  summaryPeriods as periods,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

test("daily and previous-month totals include both sources, stay exact, and ignore search and pagination", async ({
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
    summaryBucket("2026-03-16", "0"),
  ];
  fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
  await signIn(page);
  const { day, month } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("150.12 USD");

  await expect(amount(day, "Company amount")).toHaveText("142.62 USD");

  await expect(amount(month, "Reported amount")).toHaveText("0.12 USD");

  await expect(amount(month, "Company amount")).toHaveText("0.12 USD");

  await expect(day.getByLabel("2 records", { exact: true })).toBeVisible();

  await expect(month.getByLabel("2 records", { exact: true })).toBeVisible();
  for (const bounds of [
    ["gte.2026-03-15T00:00:00.000000Z", "lt.2026-03-16T00:00:00.000000Z"],
    ["gte.2026-02-01T00:00:00.000000Z", "lt.2026-03-01T00:00:00.000000Z"],
  ]) {
    const completedLoad = fixture.aggregateRequests
      .filter(({ params }) => params.getAll("activity_at").join() === bounds.join())
      .slice(-2);
    expect(completedLoad.map((request) => Number(request.params.get("offset")))).toEqual([0, 1]);
    expect(completedLoad.map((request) => request.includeCount)).toEqual([false, false]);
  }
  for (const request of fixture.latestRequests) {
    expect(request.endpoint).toBe("/rest/v1/rpc/transaction_page");
    expect(request.args).toMatchObject({
      p_limit: 1,
      p_include_count: false,
      p_order_by: "date",
      p_direction: "desc",
      p_company_ids: [],
      p_skus: [],
      p_marketplaces: [],
    });
  }
  for (const request of fixture.aggregateRequests) {
    expect(request.params.get("or")).toBeNull();
    expect(request.params.get("sku")).toBeNull();
    expect(request.endpoint).toBe("/rest/v1/rpc/transaction_totals");
    expect(request.args.p_group_by_type).toBe(false);
    expect(request.args.p_currency).toBeNull();
    expect(request.params.getAll("activity_at")).toHaveLength(2);
    expect(request.params.get("and")).toBeNull();
  }
  const summaryRequestCount = fixture.aggregateRequests.length;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill("SALE");
  await expect(
    page.getByRole("table", { name: "Financial records", exact: true }).getByRole("row"),
  ).toHaveCount(2);

  await expect(amount(day, "Reported amount")).toHaveText("150.12 USD");

  await expect(amount(month, "Reported amount")).toHaveText("0.12 USD");
  expect(fixture.aggregateRequests).toHaveLength(summaryRequestCount);

  await expect(amount(day, "Reported amount", "EUR")).toHaveText("20.00 EUR");

  await expect(amount(month, "Reported amount", "EUR")).toHaveText("10.00 EUR");

  await expect(day).toContainText("150.12 USD");

  await expect(month).toContainText("0.12 USD");
});

for (const [latest, currentStart, previousStart, previousEnd, previousLabel, dayLabel] of [
  ["2024-02-29", "2024-02-01", "2024-01-01", "2024-01-31", "January 2024", "Feb 28, 2024"],
  ["2026-01-31", "2026-01-01", "2025-12-01", "2025-12-31", "December 2025", "Jan 30, 2026"],
]) {
  test(`month-end latest date ${latest} still selects the previous calendar month`, async ({
    page,
  }) => {
    const fixture = await mockSupabase(page);
    fixture.aggregateRows = [
      summaryBucket(previousEnd, "500"),
      summaryBucket(currentStart, "10"),
      summaryBucket(latest, "20", { serviceFee: "-1", companyAmount: "19" }),
    ];
    await signIn(page);
    const { summaries, day, month, selected } = periods(page);
    await expect(summaryCard(page, "Last day")).toContainText(dayLabel);
    await expect(day).toContainText("No transactions");
    await expect(summaryCard(page, "Last month")).toContainText(previousLabel);
    await expect(amount(month, "Reported amount")).toHaveText("500.00 USD");
    await expect(amount(month, "Company amount")).toHaveText("500.00 USD");
    await expect(month.getByLabel("1 records", { exact: true })).toBeVisible();
    await expect(summaries.getByRole("combobox")).toHaveCount(0);
    await summaryCard(page, "Last month")
      .getByRole("button", {
        name: `Filter transactions to ${previousLabel} · UTC`,
        exact: true,
      })
      .click();
    await expect
      .poll(() => fixture.requests.at(-1).args)
      .toMatchObject({
        p_date_from: previousStart,
        p_date_to: previousEnd,
      });
    await expect(amount(selected, "Reported amount")).toHaveText("500.00 USD");
    await expect(summaryCard(page, "Last month")).toContainText(previousLabel);
    expect(fixture.latestRequests).toHaveLength(1);
  });
}

test("a selected previous month without activity is empty rather than falling back to an older month", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [summaryBucket("2026-04-30", "999"), summaryBucket("2026-06-12", "10")];
  await signIn(page);
  const { day, month } = periods(page);

  await expect(summaryCard(page, "Last day")).toContainText("Jun 11, 2026");
  await expect(day).toContainText("No transactions");

  await expect(summaryCard(page, "Last month")).toContainText("May 2026");

  await expect(month).toContainText(/No transactions/);

  await expect(month).not.toContainText("999.00 USD");
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
      summaryBucket("2026-06-01", "0"),
    ];
    await signIn(page);
    const { day, month, selected } = periods(page);
    await applyDates(page, "2026-05-31", "2026-05-31");
    for (const period of [day, month, selected]) {
      await expect(amount(period, "Reported amount")).toHaveText("300.00 USD");
      await expect(amount(period, "Known company amount")).toHaveText(known ? "95.00 USD" : "—");
      await expect(amount(period, "Service fee")).toHaveText(known ? "-5.00 USD" : "—");
      await expect(period).toContainText("2 uncalculated");
    }
  });
}

test("changing account and role clears every currency before new totals arrive", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-b"] = "administrator";
  fixture.aggregateRowsByUser = {
    "member-a": [
      summaryBucket("2026-03-15", "7", { currency: "EUR" }),
      summaryBucket("2026-03-15", "42"),
      summaryBucket("2026-03-16", "0"),
    ],
    "member-b": [summaryBucket("2026-03-15", "907"), summaryBucket("2026-03-16", "0")],
  };
  await signIn(page);
  const { summaries, day, selected } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("42.00 USD");

  await expect(amount(day, "Reported amount", "EUR")).toHaveText("7.00 EUR");
  await applyDates(page, "2026-03-15", "2026-03-15");

  await expect(amount(selected, "Reported amount", "EUR")).toHaveText("7.00 EUR");
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
  await expect(summaries).not.toContainText("7.00 EUR");
  await expect(summaries).not.toContainText("42.00 USD");
  release.resolve();

  await expect(amount(day, "Reported amount")).toHaveText("907.00 USD");
  await expect(summaries.getByRole("combobox")).toHaveCount(0);

  await expect(selected).toContainText("Choose dates");

  await expect(amount(selected, "Reported amount")).toHaveCount(0);
});

test("latest-date errors leave transactions usable and Retry summaries can recover", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.latestStatus = 403;
  fixture.aggregateRows = [summaryBucket("2026-03-15", "10"), summaryBucket("2026-03-16", "0")];
  await signIn(page);
  await expect(rowWithSku(page, "ALPHA-001")).toBeVisible();
  const { summaries, day } = periods(page);
  await expect(summaries.getByRole("alert")).toContainText("HTTP 403");
  expect(fixture.aggregateRequests).toHaveLength(0);
  fixture.latestStatus = 200;
  await summaries.getByRole("button", { name: "Retry summaries", exact: true }).click();

  await expect(amount(day, "Reported amount")).toHaveText("10.00 USD");
  await expect(summaries.getByRole("alert")).toHaveCount(0);
});
