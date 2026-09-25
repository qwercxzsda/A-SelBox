import { liveRow } from "./api-fixtures.mjs";
import { applyDates } from "./table-actions.mjs";
import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";
import {
  summaryBucket,
  summaryCards as cards,
  summaryAmount as amount,
} from "./summary-fixtures.mjs";

test("period shortcuts reset pagination, preserve other refinements, and return to Transactions", async ({
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
  ];
  await signIn(page);
  const { day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("130 USD");
  await expect(amount(month, "Reported amount")).toHaveText("32 USD");
  await expect(selected).toContainText("Select a date range to see totals.");
  await expect(selected.locator("dl")).toHaveCount(0);
  const aggregateRequests = fixture.aggregateRequests.length;

  await page.getByLabel("Search", { exact: true }).fill("TARGET");
  await expect.poll(() => fixture.requests.at(-1).params.get("or")).toContain("TARGET");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Source options", exact: true });
  await source.getByRole("checkbox", { name: "Settlements", exact: true }).check();
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
  await month.getByRole("button", { name: /^Filter transactions to / }).click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await expect(amount(selected, "Reported amount")).toHaveText("32 USD");
  expect(fixture.requests.at(-1).params.getAll("activity_date")).toEqual([
    "gte.2026-02-01",
    "lte.2026-02-28",
  ]);
  expect(fixture.requests.at(-1).params.get("offset")).toBe("0");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  const dayShortcut = day.getByRole("button", { name: /^Filter transactions to / });
  await dayShortcut.focus();
  await dayShortcut.press("Enter");
  await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
  await expect(amount(selected, "Reported amount")).toHaveText("130 USD");
  await expect(selected).toContainText("32 records");
  const request = fixture.requests.at(-1).params;
  expect(request.getAll("activity_date")).toEqual(["gte.2026-03-15", "lte.2026-03-15"]);
  expect(request.get("offset")).toBe("0");
  expect(request.get("source")).toBe('in.("SETTLEMENT")');
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
  ];
  fixture.liveRows = fixture.aggregateRows.map((row, index) => ({
    ...liveRow("RANGE", index + 1),
    activity_date: row.activity_date,
    currency: row.currency,
    source_amount: row.reported_amount,
  }));
  await signIn(page);
  const { summaries, day, month, selected } = cards(page);
  await expect(amount(day, "Reported amount")).toHaveText("40 USD");
  await expect(amount(month, "Reported amount")).toHaveText("20 USD");
  await expect(summaries.getByLabel("Currency", { exact: true })).toHaveCount(0);
  const aggregateRequests = fixture.aggregateRequests.length;

  await applyDates(page, "2026-01-10", "2026-01-11");
  await expect(amount(selected, "Reported amount")).toHaveText("5 USD");
  expect(fixture.aggregateRequests).toHaveLength(aggregateRequests + 1);
  const currency = summaries.getByLabel("Currency", { exact: true });
  await expect(currency.locator("option")).toHaveText(["JPY", "USD"]);
  await currency.selectOption("JPY");
  await expect(amount(selected, "Reported amount")).toHaveText("100.12345678901234568 JPY");
  await expect(selected).toContainText("2 records");
  await expect(day).toContainText("No transactions in JPY.");
  expect(fixture.aggregateRequests).toHaveLength(aggregateRequests + 1);

  await applyDates(page, "2026-01-11", "");
  await expect(amount(selected, "Reported amount")).toHaveText("0.000000000000000002 JPY");
  await expect
    .poll(() => fixture.requests.at(-1).params.getAll("activity_date"))
    .toEqual(["gte.2026-01-11"]);
  await currency.selectOption("USD");
  await expect(amount(selected, "Reported amount")).toHaveText("65 USD");

  await applyDates(page, "", "2026-01-10");
  await currency.selectOption("JPY");
  await expect(amount(selected, "Reported amount")).toHaveText("100.123456789012345678 JPY");
  await expect
    .poll(() => fixture.requests.at(-1).params.getAll("activity_date"))
    .toEqual(["lte.2026-01-10"]);
  await applyDates(page, "2026-01-20", "2026-01-25");
  await expect(selected).toContainText("No transactions in USD.");
  await expect(selected.locator("dl")).toHaveCount(0);
  const periodRequestCount = fixture.aggregateRequests.length;
  expect(periodRequestCount).toBe(aggregateRequests + 4);

  await page.getByRole("button", { name: "Date", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Date options", exact: true })
    .getByRole("button", { name: "Clear dates", exact: true })
    .click();
  await expect(selected).toContainText("Select a date range to see totals.");
  await expect(selected.locator("dl")).toHaveCount(0);
  await expect(amount(day, "Reported amount")).toHaveText("40 USD");
  expect(fixture.aggregateRequests).toHaveLength(periodRequestCount);
});

for (const width of [320, 390]) {
  test(`three estimated cards fit ${width}px and the date shortcut works with Space`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await mockSupabase(page);
    const precise = "12345678901234567890.123456789012345678";
    const displayed = "12,345,678,901,234,567,890.123456789012345678 USD";
    fixture.aggregateRows = [
      summaryBucket("2026-02-05", "20"),
      summaryBucket("2026-03-15", precise),
    ];
    await signIn(page);
    const { summaries, day, selected } = cards(page);
    await expect(amount(day, "Reported amount")).toHaveText(displayed);
    const shortcut = day.getByRole("button", { name: /^Filter transactions to / });
    await shortcut.focus();
    await shortcut.press("Space");
    await expect(amount(selected, "Reported amount")).toHaveText(displayed);
    const articles = summaries.getByRole("article");
    await expect(articles).toHaveCount(3);
    const dimensions = await articles.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      }),
    );
    for (const bounds of dimensions) {
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
