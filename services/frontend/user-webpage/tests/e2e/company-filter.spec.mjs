import { liveRow } from "./api-fixtures.mjs";
import { applyDates, columnTrigger, columnHeader } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn, waitForRequestSettled } from "./fixtures.mjs";
import { filterRecordRows } from "./record-fixtures.mjs";
import { periodBucketTotals } from "./aggregate-fixtures.mjs";
import {
  summaryBucket,
  summaryCard,
  summaryPeriods as periods,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const companyScope = (...ids) => `in.(${[...new Set(ids)].sort().join(",")})`;

async function companyFixture(page) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds = { "member-a": COMPANY_A, "member-b": COMPANY_B };
  fixture.companyNames = { [COMPANY_A]: "Company A", [COMPANY_B]: "Company B" };
  const bucket = (company, date, value, options) => ({
    ...summaryBucket(date, value, options),
    company_id: company,
    source: "FINANCES",
  });
  fixture.aggregateRows = [
    bucket(COMPANY_A, "2026-01-10", "5"),
    bucket(COMPANY_A, "2026-02-05", "10"),
    bucket(COMPANY_A, "2026-02-28", "100.123456789012345678", {
      serviceFee: "-5.123456789012345678",
      companyAmount: "95",
    }),
    bucket(COMPANY_A, "2026-02-28", "20", { currency: "EUR" }),
    bucket(COMPANY_B, "2026-02-28", "900"),
    bucket(COMPANY_B, "2026-03-05", "200"),
    bucket(COMPANY_B, "2026-04-20", "300"),
    bucket(COMPANY_B, "2026-04-21", "0"),
    bucket(null, "2026-01-15", "7"),
  ];
  fixture.aggregateRowsByUser["member-b"] = fixture.aggregateRows.filter(
    (row) => row.company_id === COMPANY_B,
  );
  fixture.breakdownRowsForRequest = ({ user, params }) =>
    periodBucketTotals(
      filterRecordRows(fixture.aggregateRowsByUser[user] ?? fixture.aggregateRows, params),
      params,
    ).map((row) => ({
      ...row,
      component_type: "PRINCIPAL",
    }));
  fixture.liveRows = [COMPANY_A, COMPANY_B].flatMap((company, companyIndex) =>
    Array.from({ length: 30 }, (_, index) => ({
      ...liveRow(companyIndex === 0 ? "ALPHA" : "BRAVO", index + 1, company),
      activity_date: "2026-02-28",
    })),
  );
  fixture.liveRows.push({ ...liveRow("UNASSIGNED", 1, null), activity_date: "2026-01-15" });
  return fixture;
}

async function chooseCompanies(page, names) {
  await columnTrigger(page, "Company").click();
  const menu = page.getByRole("dialog", { name: "Company options", exact: true });
  await expect(menu.getByRole("checkbox")).toHaveCount(2);
  await expect(menu.getByLabel("Search company", { exact: true })).toHaveCount(0);
  if (names.length === 0) {
    await menu.getByRole("button", { name: "Clear company", exact: true }).click();
  } else {
    for (const name of ["Company A", "Company B"]) {
      await menu.getByRole("checkbox", { name, exact: true }).setChecked(names.includes(name));
      await expect(menu).toBeVisible();
    }
  }
  await menu.getByRole("button", { name: "Close options", exact: true }).click();
  await expect(menu).toHaveCount(0);
}

test("administrator company selections change amounts while shared UTC periods stay fixed", async ({
  page,
}) => {
  const fixture = await companyFixture(page);
  await signIn(page);
  const { day, month, selected } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("200.00 USD");
  const optionsBefore = fixture.optionRequests.length;
  const latestRequests = fixture.latestRequests.length;
  await expect(
    summaryCard(page, "Last day").getByRole("button", {
      name: "Filter transactions to Apr 20, 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    summaryCard(page, "Last month").getByRole("button", {
      name: "Filter transactions to March 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);
  await chooseCompanies(page, ["Company A"]);

  await expect(day).toContainText("No transactions");
  await expect(month).toContainText("No transactions");
  await expect(day.locator("[data-amount-field]")).toHaveCount(0);
  await expect(month.locator("[data-amount-field]")).toHaveCount(0);
  await expect(
    summaryCard(page, "Last day").getByRole("button", {
      name: "Filter transactions to Apr 20, 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    summaryCard(page, "Last month").getByRole("button", {
      name: "Filter transactions to March 2026 · UTC",
      exact: true,
    }),
  ).toHaveCount(1);

  await expect(selected).toContainText("Choose dates");
  expect(fixture.optionRequests).toHaveLength(optionsBefore);
  expect(fixture.latestRequests).toHaveLength(latestRequests);
  expect(fixture.latestRequests.at(-1).params.get("company_id")).toBeNull();
  expect(
    fixture.aggregateRequests
      .filter(({ params }) => params.get("company_id") === companyScope(COMPANY_A))
      .map(({ params }) => params.getAll("activity_at")),
  ).toEqual([
    ["gte.2026-04-20T00:00:00.000000Z", "lt.2026-04-21T00:00:00.000000Z"],
    ["gte.2026-03-01T00:00:00.000000Z", "lt.2026-04-01T00:00:00.000000Z"],
  ]);
  await applyDates(page, "2026-01-01", "2026-02-28");

  await expect(amount(selected, "Reported amount")).toHaveText("115.12 USD");
  expect(fixture.aggregateRequests.at(-1).params.get("company_id")).toBe(companyScope(COMPANY_A));

  await page
    .getByRole("button", {
      name: "View Selected dates for Amazon.com in USD by type",
      exact: false,
    })
    .click();
  const drawer = page.getByRole("dialog", { name: "Transaction totals", exact: true });
  const total = drawer.getByRole("region", { name: "Breakdown total", exact: true });
  await expect(amount(total, "Reported amount")).toHaveText("115.12 USD");
  await expect(amount(total, "Company amount")).toHaveText("110.00 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("company_id")).toBe(companyScope(COMPANY_A));
  expect(fixture.breakdownRequests.at(-1).params.getAll("activity_at")).toEqual([
    "gte.2026-01-01T00:00:00.000000Z",
    "lt.2026-03-01T00:00:00.000000Z",
  ]);
  await drawer.getByRole("button", { name: "Close breakdown", exact: true }).click();

  await expect(amount(day, "Reported amount", "EUR")).toHaveCount(0);
  await expect(amount(month, "Reported amount", "EUR")).toHaveCount(0);

  await expect(amount(selected, "Reported amount", "EUR")).toHaveText("20.00 EUR");

  await chooseCompanies(page, ["Company B"]);

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("200.00 USD");

  await expect(amount(selected, "Reported amount")).toHaveText("900.00 USD");
  expect(fixture.latestRequests).toHaveLength(latestRequests);

  await page
    .getByRole("button", {
      name: "View Selected dates for Amazon.com in USD by type",
      exact: false,
    })
    .click();
  await expect(amount(total, "Reported amount")).toHaveText("900.00 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("company_id")).toBe(companyScope(COMPANY_B));
  await drawer.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await chooseCompanies(page, ["Company B", "Company A"]);

  await expect(amount(selected, "Reported amount")).toHaveText("1,015.12 USD");

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("200.00 USD");
  expect(fixture.latestRequests).toHaveLength(latestRequests);
  expect(fixture.aggregateRequests.at(-1).params.get("company_id")).toBe(
    companyScope(COMPANY_A, COMPANY_B),
  );

  await page
    .getByRole("button", {
      name: "View Selected dates for Amazon.com in USD by type",
      exact: false,
    })
    .click();
  await expect(amount(total, "Reported amount")).toHaveText("1,015.12 USD");
  expect(fixture.breakdownRequests.at(-1).params.get("company_id")).toBe(
    companyScope(COMPANY_A, COMPANY_B),
  );
  await drawer.getByRole("button", { name: "Close breakdown", exact: true }).click();
  await chooseCompanies(page, ["Company A"]);

  await expect(amount(selected, "Reported amount")).toHaveText("115.12 USD");
  await chooseCompanies(page, []);

  await expect(amount(selected, "Reported amount")).toHaveText("1,022.12 USD");
  await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText(
    "1–25 of 61 rows",
  );
  for (const requests of [fixture.requests, fixture.aggregateRequests]) {
    expect(
      requests.some(
        ({ params }) =>
          params.get("company_id") === null &&
          params.getAll("activity_at").includes("gte.2026-01-01T00:00:00.000000Z"),
      ),
    ).toBe(true);
  }
});

test("company selection resets only the page and clearing it preserves other refinements", async ({
  page,
}) => {
  const fixture = await companyFixture(page);
  await signIn(page);
  await applyDates(page, "2026-01-01", "2026-04-30");
  await page.getByLabel("Search", { exact: true }).fill("Amazon");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("Amazon");
  await columnTrigger(page, "Source").click();
  const source = page.getByRole("dialog", { name: "Source options", exact: true });
  await source.getByRole("checkbox", { name: "Finances", exact: true }).check();
  await source.getByRole("button", { name: "Close options", exact: true }).click();
  await page.getByRole("button", { name: "Reported amount", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Reported amount options", exact: true })
    .getByRole("button", { name: "Highest first", exact: true })
    .click();
  await expect(page.getByRole("form", { name: "Page 1 of 3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 3", exact: true })).toBeVisible();
  const order = fixture.requests.at(-1).params.get("order");
  await chooseCompanies(page, ["Company A"]);
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  const scoped = fixture.requests.at(-1).params;
  expect(scoped.get("company_id")).toBe(companyScope(COMPANY_A));
  expect(scoped.get("offset")).toBe("0");
  expect(scoped.get("source")).toBe('in.("FINANCES")');
  expect(scoped.get("or")).toContain("Amazon");
  expect(scoped.get("order")).toBe(order);
  expect(scoped.getAll("activity_at")).toEqual([
    "gte.2026-01-01T00:00:00.000000Z",
    "lt.2026-05-01T00:00:00.000000Z",
  ]);

  await expect(amount(periods(page).selected, "Reported amount")).toHaveText("115.12 USD");
  for (const { params } of fixture.aggregateRequests.filter(
    ({ params }) => params.get("company_id") === companyScope(COMPANY_A),
  )) {
    expect(params.get("or")).toContain("Amazon");
    expect(params.get("source")).toBe('in.("FINANCES")');
  }
  const table = page.getByRole("table", { name: "Financial records", exact: true });
  await expect(table.getByRole("cell", { name: "Company A", exact: true })).toHaveCount(25);
  await expect(table.getByRole("cell", { name: "Company B", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(table.getByRole("cell", { name: "Company A", exact: true })).toHaveCount(25);
  await chooseCompanies(page, []);
  await expect(page.getByRole("form", { name: "Page 1 of 3", exact: true })).toBeVisible();
  await expect(amount(periods(page).selected, "Reported amount")).toHaveText("1,522.12 USD");
  const clearedCompanyTotal = fixture.aggregateRequests.findLast(
    ({ args }) => args.p_date_from === "2026-01-01" && args.p_company_ids.length === 0,
  );
  expect(clearedCompanyTotal.params.get("source")).toBe('in.("FINANCES")');
  expect(clearedCompanyTotal.params.get("or")).toContain("Amazon");
  expect(fixture.requests.at(-1).params.get("source")).toBe('in.("FINANCES")');
  expect(fixture.requests.at(-1).params.getAll("activity_at")).toEqual([
    "gte.2026-01-01T00:00:00.000000Z",
    "lt.2026-05-01T00:00:00.000000Z",
  ]);
  await chooseCompanies(page, ["Company B"]);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 1 of 3", exact: true })).toBeVisible();
  const cleared = fixture.requests.at(-1).params;
  expect(cleared.get("company_id")).toBeNull();
  expect(cleared.get("source")).toBeNull();
  expect(cleared.getAll("activity_at")).toEqual([]);
  expect(cleared.get("order")).toBe(order);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Amazon");

  await expect(periods(page).selected).toContainText("Choose dates");
});

test("an unresolved company scope hides old totals and its late response cannot replace the next company", async ({
  page,
}) => {
  const fixture = await companyFixture(page);
  await signIn(page);
  const { day, month, selected } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");
  await applyDates(page, "2026-01-01", "2026-02-28");

  await expect(amount(selected, "Reported amount")).toHaveText("1,022.12 USD");
  const started = deferred();
  const release = deferred();
  const latestRequests = fixture.latestRequests.length;
  fixture.beforeAggregates = async ({ params }) => {
    if (params.get("company_id") === companyScope(COMPANY_A)) {
      started.resolve();
      await release.promise;
    }
  };
  const olderSettled = waitForRequestSettled(page, (request) => {
    if (new URL(request.url()).pathname !== "/rest/v1/rpc/transaction_totals") return false;
    const args = request.postDataJSON();
    return (
      !args.p_group_by_type &&
      args.p_company_ids.length === 1 &&
      args.p_company_ids[0] === COMPANY_A
    );
  });
  await chooseCompanies(page, ["Company A"]);
  await started.promise;

  await expect(day.getByLabel("Loading Amazon.com last day totals", { exact: true })).toBeVisible();

  await expect(
    selected.getByLabel("Loading Amazon.com selected dates totals", { exact: true }),
  ).toBeVisible();

  await expect(day).not.toContainText("300.00 USD");

  await expect(selected).not.toContainText("1,022.12 USD");
  await chooseCompanies(page, ["Company B"]);

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("200.00 USD");

  await expect(amount(selected, "Reported amount")).toHaveText("900.00 USD");
  release.resolve();
  await olderSettled;
  expect(fixture.latestRequests).toHaveLength(latestRequests);

  await selected.evaluate(
    (element) =>
      new Promise((resolve) =>
        element.ownerDocument.defaultView.requestAnimationFrame(() => resolve()),
      ),
  );

  await expect(amount(day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(selected, "Reported amount")).toHaveText("900.00 USD");
});

test("signing in as a member removes the administrator company override and control", async ({
  page,
}) => {
  const fixture = await companyFixture(page);
  await signIn(page);
  await chooseCompanies(page, ["Company A"]);

  await expect(periods(page).day).toContainText("No transactions");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  fixture.liveRows = fixture.liveRows.filter((row) => row.company_id === COMPANY_B);
  await signIn(page, "member-b");
  await expect(columnTrigger(page, "Company")).toHaveCount(0);
  await expect(columnHeader(page, "Company")).toHaveCount(0);

  await expect(amount(periods(page).day, "Reported amount")).toHaveText("300.00 USD");

  await expect(amount(periods(page).month, "Reported amount")).toHaveText("200.00 USD");

  await expect(periods(page).selected).toContainText("Choose dates");

  await page
    .getByRole("button", { name: "View Last day for Amazon.com in USD by type", exact: false })
    .click();
  const total = page
    .getByRole("dialog", { name: "Transaction totals", exact: true })
    .getByRole("region", { name: "Breakdown total", exact: true });
  await expect(amount(total, "Reported amount")).toHaveText("300.00 USD");
  for (const request of [
    ...fixture.requests,
    ...fixture.latestRequests,
    ...fixture.aggregateRequests,
    ...fixture.breakdownRequests,
  ].filter(({ user }) => user === "member-b")) {
    expect(request.params.get("company_id")).toBeNull();
  }
});
