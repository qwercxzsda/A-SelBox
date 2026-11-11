import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { applyDates, columnTrigger } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCard,
  summaryPeriods,
  summaryAmount,
  typeBucket,
} from "./summary-fixtures.mjs";

const drawer = (page) => page.getByRole("dialog", { name: "Amounts by type", exact: true });
const view = (page, title, currency = "USD") =>
  page.getByRole("button", {
    name: `View ${title} for Amazon.com in ${currency} by type`,
    exact: false,
  });

async function closeBreakdown(page) {
  await drawer(page).getByRole("button", { name: "Close breakdown", exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
}

async function expandGroups(page) {
  const buttons = drawer(page).getByRole("button", { name: / details$/ });
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
  }
}

test("breakdowns load lazily for the chosen period and all types, independently of source and search filters", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.breakdownPageCap = 1;
  fixture.aggregateRows = [
    summaryBucket("2026-02-28", "97.123456789012345678", {
      serviceFee: "-5.123456789012345678",
      companyAmount: "85",
      rowCount: 5,
      knownCompanyCount: 3,
    }),
    summaryBucket("2026-03-15", "50"),
    summaryBucket("2026-03-16", "0"),
  ];
  fixture.breakdownRows = [
    typeBucket("PRINCIPAL", "100.123456789012345678", {
      serviceFee: "-5.123456789012345678",
      companyAmount: "95",
      rowCount: 2,
    }),
    typeBucket("REFERRAL_FEE", "-10"),
    typeBucket("UNPRICED", "7", {
      serviceFee: null,
      companyAmount: null,
      rowCount: 2,
      knownCompanyCount: 0,
    }),
  ];
  fixture.liveRows = [
    { ...liveRow("TARGET", 1), activity_date: "2026-03-15" },
    {
      ...liveRow("OTHER", 2),
      activity_date: "2026-03-15",
      source: "DATA_KIOSK",
    },
  ];
  fixture.assignments = skuAssignments((fixture.liveRows ?? []).map(({ sku }) => sku));
  await signIn(page);

  await expect(view(page, "Last day")).toBeVisible();

  await expect(view(page, "Selected dates")).toHaveCount(0);
  expect(fixture.breakdownRequests).toHaveLength(0);

  await summaryCard(page, "Last day")
    .getByRole("button", { name: /^Filter transactions to / })
    .click();

  await expect(view(page, "Selected dates")).toBeVisible();
  await expect(drawer(page)).toHaveCount(0);
  expect(fixture.breakdownRequests).toHaveLength(0);
  await page.getByLabel("Search", { exact: true }).fill("TARGET");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("TARGET");
  await columnTrigger(page, "Source").click();
  const source = page.getByRole("dialog", { name: "Source options", exact: true });
  await source.getByRole("checkbox", { name: "Finances", exact: true }).check();
  await source.getByRole("button", { name: "Close options", exact: true }).click();
  await expect.poll(() => fixture.requests.at(-1).params.get("source")).toBe('in.("FINANCES")');
  const tableRequestCount = fixture.requests.length;
  const summaryRequestCount = fixture.aggregateRequests.length;

  await view(page, "Last month").click();
  await expandGroups(page);
  const dialog = drawer(page);
  const table = dialog.getByRole("table", { name: "Transaction type amounts", exact: true });
  await expect(table.getByRole("row", { name: / amounts$/ })).toHaveCount(3);
  const principal = table.getByRole("row", { name: "Principal amounts", exact: true });
  await expect(principal.getByRole("cell").nth(0)).toHaveText("100.12 USD");
  await expect(principal.getByRole("cell").nth(1)).toHaveText("-5.12 USD");
  await expect(table.getByRole("row", { name: "Referral fee amounts", exact: true })).toContainText(
    "-10.00 USD",
  );
  await expect(
    table.getByRole("row", { name: "Unpriced amounts", exact: true }).getByRole("cell"),
  ).toHaveText(["7.00 USD", "—", "—", "2"]);
  const total = dialog.getByRole("region", { name: "Breakdown total", exact: true });
  await expect(summaryAmount(total, "Reported amount")).toHaveText("97.12 USD");
  await expect(summaryAmount(total, "Known company amount")).toHaveText("85.00 USD");
  await expect(total).toContainText("5 records across 3 types");
  await expect(total).toContainText("2 transactions have uncalculated amounts.");
  expect(fixture.breakdownRequests.map((request) => Number(request.params.get("offset")))).toEqual([
    0, 1, 2,
  ]);
  expect(fixture.breakdownRequests.map((request) => request.includeCount)).toEqual([
    false,
    false,
    false,
  ]);
  for (const { params, args, endpoint } of fixture.breakdownRequests) {
    expect(params.getAll("activity_at")).toEqual([
      "gte.2026-02-01T00:00:00.000000Z",
      "lt.2026-03-01T00:00:00.000000Z",
    ]);
    expect(params.get("currency")).toBe("eq.USD");
    expect(endpoint).toBe("/rest/v1/rpc/transaction_totals");
    expect(args.p_group_by_type).toBe(true);
    expect(params.get("and")).toBeNull();
    expect(args.p_marketplaces).toEqual(["Amazon.com"]);
    for (const excluded of ["or", "source", "sku", "component_type"]) {
      expect(params.get(excluded)).toBeNull();
    }
  }
  expect(fixture.requests).toHaveLength(tableRequestCount);
  expect(fixture.aggregateRequests).toHaveLength(summaryRequestCount);
  await closeBreakdown(page);
  expect(fixture.requests.at(-1).params.getAll("activity_at")).toEqual([
    "gte.2026-03-15T00:00:00.000000Z",
    "lt.2026-03-16T00:00:00.000000Z",
  ]);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("TARGET");
});

test("breakdown cache separates currencies and open date ranges, and clearing dates removes its action", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-02-05", "10"),
    summaryBucket("2026-03-15", "20", { currency: "EUR" }),
    summaryBucket("2026-03-15", "50"),
    summaryBucket("2026-03-16", "0"),
  ];
  fixture.breakdownRowsForRequest = ({ params }) => {
    const dates = params.getAll("activity_at");
    if (dates.length === 1)
      return [typeBucket("OPEN_RANGE", "60"), typeBucket("OPEN_RANGE", "20", { currency: "EUR" })];
    return [typeBucket("USD_ONLY", "50"), typeBucket("EUR_ONLY", "20", { currency: "EUR" })];
  };
  await signIn(page);

  await view(page, "Last day").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "USD only amounts", exact: true }),
  ).toBeVisible();
  await closeBreakdown(page);

  await view(page, "Last day", "EUR").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "EUR only amounts", exact: true }),
  ).toContainText("20.00 EUR");
  await expect(drawer(page)).not.toContainText("USD only");
  await closeBreakdown(page);
  expect(fixture.breakdownRequests.map(({ params }) => params.get("currency"))).toEqual([
    "eq.USD",
    "eq.EUR",
  ]);

  await view(page, "Last day").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "USD only amounts", exact: true }),
  ).toBeVisible();
  expect(fixture.breakdownRequests).toHaveLength(2);
  await closeBreakdown(page);

  await applyDates(page, "2026-02-05", "");
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(summaryPeriods(page).summaries).toHaveCount(0);
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();

  await view(page, "Selected dates").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "Open range amounts", exact: true }),
  ).toBeVisible();
  expect(fixture.breakdownRequests.at(-1).params.getAll("activity_at")).toEqual([
    "gte.2026-02-05T00:00:00.000000Z",
  ]);
  await closeBreakdown(page);
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await applyDates(page, "", "2026-02-05");

  await view(page, "Selected dates").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "Open range amounts", exact: true }),
  ).toBeVisible();
  expect(fixture.breakdownRequests.at(-1).params.getAll("activity_at")).toEqual([
    "lt.2026-02-06T00:00:00.000000Z",
  ]);
  expect(fixture.breakdownRequests).toHaveLength(4);
  await closeBreakdown(page);
  await applyDates(page);

  await expect(view(page, "Selected dates")).toHaveCount(0);
  expect(fixture.breakdownRequests).toHaveLength(4);
});

test("a forbidden breakdown is not retried automatically and the explicit retry recovers", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [summaryBucket("2026-03-15", "7.125"), summaryBucket("2026-03-16", "0")];
  fixture.breakdownRows = [typeBucket("PRINCIPAL", "7.125")];
  fixture.breakdownStatus = 403;
  await signIn(page);

  await view(page, "Last day").click();
  await expect(drawer(page).getByRole("alert")).toContainText("HTTP 403");
  expect(fixture.breakdownRequests).toHaveLength(1);
  fixture.breakdownStatus = 200;
  await drawer(page).getByRole("button", { name: "Retry breakdown", exact: true }).click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "Principal amounts", exact: true }),
  ).toContainText("7.13 USD");
  await expect(drawer(page).getByRole("alert")).toHaveCount(0);
  expect(fixture.breakdownRequests).toHaveLength(2);
});

test("signing into another account and role never displays the previous breakdown", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-b"] = "administrator";
  fixture.aggregateRowsByUser = {
    "member-a": [
      summaryBucket("2026-03-15", "41.123456789012345678"),
      summaryBucket("2026-03-16", "0"),
    ],
    "member-b": [summaryBucket("2026-03-15", "907"), summaryBucket("2026-03-16", "0")],
  };
  fixture.breakdownRowsByUser = {
    "member-a": [typeBucket("ALPHA_ONLY", "41.123456789012345678")],
    "member-b": [typeBucket("BRAVO_ONLY", "907")],
  };
  await signIn(page);

  await view(page, "Last day").click();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "Alpha only amounts", exact: true }),
  ).toBeVisible();
  await closeBreakdown(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const started = deferred();
  const release = deferred();
  fixture.beforeBreakdown = async ({ user }) => {
    if (user === "member-b") {
      started.resolve();
      await release.promise;
    }
  };
  await signIn(page, "member-b");

  await view(page, "Last day").click();
  await started.promise;
  await expect(
    drawer(page).getByRole("status", { name: "Loading amounts by type", exact: true }),
  ).toBeVisible();
  await expect(drawer(page)).not.toContainText("Alpha only");
  await expect(drawer(page)).not.toContainText("41.12 USD");
  release.resolve();
  await expandGroups(page);
  await expect(
    drawer(page).getByRole("row", { name: "Bravo only amounts", exact: true }),
  ).toContainText("907.00 USD");
  expect(fixture.breakdownRequests.map(({ user }) => user)).toEqual(["member-a", "member-b"]);
});

for (const width of [320, 390]) {
  test(`keyboard breakdown at ${width}px keeps rounded amounts visible and restores focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    const precise = "12345678901234567890.123456789012345678";
    fixture.aggregateRows = [
      summaryBucket("2026-03-15", precise),
      summaryBucket("2026-03-16", "0"),
    ];
    fixture.breakdownRows = [typeBucket("PRINCIPAL", precise)];
    await signIn(page);
    const trigger = view(page, "Last day");
    await trigger.focus();
    await trigger.press("Enter");
    await expandGroups(page);
    const dialog = drawer(page);
    const group = dialog.getByRole("article", { name: "Principal amounts", exact: true });
    await expect(summaryAmount(group, "Reported amount")).toHaveText(
      "12,345,678,901,234,567,890.12 USD",
    );
    await expect(
      dialog.getByRole("table", { name: "Transaction type amounts", exact: true }),
    ).toHaveCount(0);
    await group.scrollIntoViewIfNeeded();
    const bounds = await group.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
