import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { applyDates, applySummaryDates, columnTrigger } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCard,
  summaryPeriods as periods,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

test("the UTC period shortcut resets list pagination and preserves refinements after a tab roundtrip", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.liveRows = [
    ...Array.from({ length: 32 }, (_, index) => ({
      ...liveRow("TARGET-FEB", index + 1),
      activity_date: index === 0 ? "2026-02-01" : "2026-02-28",
      source_amount: "1",
    })),
    ...Array.from({ length: 31 }, (_, index) => ({
      ...liveRow("TARGET-MAR", index + 1),
      activity_date: "2026-03-15",
      source_amount: "1",
    })),
    {
      ...liveRow("OTHER", 1),
      source: "DATA_KIOSK",
      activity_date: "2026-03-15",
      source_amount: "99",
    },
  ];
  fixture.aggregateRows = [
    summaryBucket("2026-02-01", "1"),
    summaryBucket("2026-02-28", "31", { rowCount: 31 }),
    summaryBucket("2026-03-15", "130", { rowCount: 32 }),
    summaryBucket("2026-03-16", "0"),
  ];
  fixture.assignments = skuAssignments((fixture.liveRows ?? []).map(({ sku }) => sku));
  await signIn(page);
  const { day, month, selected } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("130.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("32.00 USD");

  await expect(selected).toContainText("Choose dates");

  await expect(selected.locator("[data-amount-field]")).toHaveCount(0);
  const aggregateRequests = fixture.aggregateRequests.length;

  await page.getByLabel("Search", { exact: true }).fill("TARGET");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("TARGET");
  await columnTrigger(page, "Source").click();
  const source = page.getByRole("dialog", { name: "Source options", exact: true });
  await source.getByRole("checkbox", { name: "Finances", exact: true }).check();
  await source.getByRole("button", { name: "Close options", exact: true }).click();
  await page.getByRole("button", { name: "Reported amount", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Reported amount options", exact: true })
    .getByRole("button", { name: "Highest first", exact: true })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 3", exact: true })).toBeVisible();
  const ordering = fixture.requests.at(-1).params.get("order");
  await page.getByRole("tab", { name: "Current fees", exact: true }).click();
  await expect(periods(page).summaries).toHaveCount(0);
  await page.getByRole("tab", { name: "Transactions", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 3", exact: true })).toBeVisible();

  await summaryCard(page, "Last month")
    .getByRole("button", { name: "Filter transactions to February 2026 · UTC", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();

  await expect(amount(selected, "Reported amount")).toHaveText("32.00 USD");
  expect(fixture.requests.at(-1).params.getAll("activity_at")).toEqual([
    "gte.2026-02-01T00:00:00.000000Z",
    "lt.2026-03-01T00:00:00.000000Z",
  ]);
  expect(fixture.requests.at(-1).params.get("offset")).toBe("0");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await applyDates(page, "2026-03-15", "2026-03-15");
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();

  await expect(amount(selected, "Reported amount")).toHaveText("130.00 USD");

  await expect(selected.getByLabel("32 records", { exact: true })).toBeVisible();
  const request = fixture.requests.at(-1).params;
  expect(request.getAll("activity_at")).toEqual([
    "gte.2026-03-15T00:00:00.000000Z",
    "lt.2026-03-16T00:00:00.000000Z",
  ]);
  expect(request.get("offset")).toBe("0");
  expect(request.get("source")).toBe('in.("FINANCES")');
  expect(request.get("or")).toContain("TARGET");
  expect(request.get("order")).toBe(ordering);
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("TARGET");
  expect(fixture.aggregateRequests).toHaveLength(aggregateRequests);
});

test("manual dates include endpoints, support open ranges, and expose currencies found only in that range", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.aggregateRows = [
    summaryBucket("2026-01-10", "100.123456789012345678", { currency: "JPY" }),
    summaryBucket("2026-01-11", "0.000000000000000002", { currency: "JPY" }),
    summaryBucket("2026-01-11", "5"),
    summaryBucket("2026-02-05", "20"),
    summaryBucket("2026-03-15", "40"),
    summaryBucket("2026-03-16", "0"),
  ];
  fixture.liveRows = fixture.aggregateRows.map((row, index) => ({
    ...liveRow("RANGE", index + 1),
    activity_date: row.activity_date,
    currency: row.currency,
    source_amount: row.reported_amount,
  }));
  await signIn(page);
  const { summaries, day, month, selected } = periods(page);

  await expect(amount(day, "Reported amount")).toHaveText("40.00 USD");

  await expect(amount(month, "Reported amount")).toHaveText("20.00 USD");
  await expect(summaries.getByRole("combobox")).toHaveCount(0);
  const aggregateRequests = fixture.aggregateRequests.length;

  await applySummaryDates(page, "2026-01-10", "2026-01-11");

  await expect(amount(selected, "Reported amount")).toHaveText("5.00 USD");
  expect(fixture.aggregateRequests).toHaveLength(aggregateRequests + 1);

  await expect(selected.locator('tr[data-currency="JPY"]')).toBeVisible();

  await expect(selected.locator('tr[data-currency="USD"]')).toBeVisible();

  await expect(amount(selected, "Reported amount", "JPY")).toHaveText("100.12 JPY");

  await expect(selected.getByLabel("2 records", { exact: true })).toBeVisible();

  await expect(day.locator('tr[data-currency="JPY"]')).toHaveCount(0);
  expect(fixture.aggregateRequests).toHaveLength(aggregateRequests + 1);

  await applySummaryDates(page, "2026-01-11", "");

  await expect(amount(selected, "Reported amount", "JPY")).toHaveText("0.00 JPY");
  await expect
    .poll(() => fixture.requests.at(-1).params.getAll("activity_at"))
    .toEqual(["gte.2026-01-11T00:00:00.000000Z"]);

  await expect(amount(selected, "Reported amount")).toHaveText("65.00 USD");

  await applySummaryDates(page, "", "2026-01-10");

  await expect(amount(selected, "Reported amount", "JPY")).toHaveText("100.12 JPY");
  await expect
    .poll(() => fixture.requests.at(-1).params.getAll("activity_at"))
    .toEqual(["lt.2026-01-11T00:00:00.000000Z"]);
  await applySummaryDates(page, "2026-01-20", "2026-01-25");

  await expect(selected).toContainText("No transactions");

  await expect(selected.locator("[data-amount-field]")).toHaveCount(0);
  const periodRequestCount = fixture.aggregateRequests.length;
  expect(periodRequestCount).toBe(aggregateRequests + 4);

  await columnTrigger(page, "Date (UTC)").click();
  await page
    .getByRole("dialog", { name: "Date (UTC) options", exact: true })
    .getByRole("button", { name: "Clear dates", exact: true })
    .click();

  await expect(selected).toContainText("Choose dates");

  await expect(selected.locator("[data-amount-field]")).toHaveCount(0);

  await expect(day.locator('tr[data-currency="JPY"]')).toHaveCount(0);

  await expect(amount(day, "Reported amount")).toHaveText("40.00 USD");
  expect(fixture.aggregateRequests).toHaveLength(periodRequestCount);
});

for (const width of [320, 390]) {
  test(`three totals cards fit ${width}px and the shared date chooser works with Space`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    const precise = "12345678901234567890.123456789012345678";
    const displayed = "12,345,678,901,234,567,890.12 USD";
    fixture.aggregateRows = [
      summaryBucket("2026-02-05", "20"),
      summaryBucket("2026-03-15", precise),
      summaryBucket("2026-03-16", "0"),
    ];
    await signIn(page);
    const { summaries, day, selected } = periods(page);

    await expect(amount(day, "Reported amount")).toHaveText(displayed);
    const shortcut = summaries.getByRole("button", { name: "Choose dates · UTC", exact: true });
    await shortcut.focus();
    await shortcut.press("Space");
    const chooser = page.getByRole("dialog", { name: "Choose summary dates", exact: true });
    await chooser.getByLabel("From date", { exact: true }).fill("2026-03-15");
    await chooser.getByLabel("To date", { exact: true }).fill("2026-03-15");
    await chooser.getByRole("button", { name: "Apply dates", exact: true }).click();

    await expect(amount(selected, "Reported amount")).toHaveText(displayed);
    const bounds = await summaries.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expect(summaries.getByRole("article")).toHaveCount(3);
    for (const title of ["Last day", "Last month", "Selected dates"]) {
      const card = summaries.getByRole("article", { name: `${title} totals`, exact: true });
      const dimensions = await card.evaluate((element) => ({
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height + 1);
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
