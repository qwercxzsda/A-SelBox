import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, rowWithSku, signIn } from "./fixtures.mjs";
import { applyDates, sortBy } from "./table-actions.mjs";
import {
  summaryAmount,
  summaryBucket,
  summaryCard,
  summaryPeriods,
  typeBucket,
} from "./summary-fixtures.mjs";

for (const timezoneId of ["Asia/Seoul", "America/Los_Angeles"]) {
  test.describe(`UTC transaction timeline in a ${timezoneId} browser`, () => {
    test.use({ timezoneId });
    test("orders real instants and assumed day ends, with UTC selected totals matching records", async ({
      page,
    }, testInfo) => {
      const fixture = await mockSupabase(page);
      fixture.liveRows = [
        {
          ...liveRow("US-FINANCE", 1),
          activity_date: "2026-11-05",
          activity_at: "2026-11-06T07:57:20.000000Z",
          source_amount: "10",
        },
        {
          ...liveRow("JP-FINANCE", 1),
          marketplace_name: "Amazon.co.jp",
          activity_date: "2026-11-06",
          activity_at: "2026-11-06T14:40:33.000000Z",
          source_amount: "20",
        },
        {
          ...liveRow("US-KIOSK", 1),
          source: "DATA_KIOSK",
          activity_date: "2026-11-05",
          activity_at: "2026-11-06T07:59:59.999999Z",
          source_amount: "3",
        },
        {
          ...liveRow("JP-KIOSK", 1),
          source: "DATA_KIOSK",
          marketplace_name: "Amazon.co.jp",
          activity_date: "2026-11-06",
          activity_at: "2026-11-06T14:59:59.999999Z",
          source_amount: "4",
        },
        {
          ...liveRow("NEXT-UTC-DAY", 1),
          activity_date: "2026-11-06",
          activity_at: "2026-11-07T00:00:00.000000Z",
          source_amount: "100",
        },
      ];
      fixture.assignments = skuAssignments(fixture.liveRows.map(({ sku }) => sku));
      fixture.aggregateRows = fixture.liveRows.map((row) => ({
        ...summaryBucket(row.activity_date, row.source_amount, {
          marketplace: row.marketplace_name,
        }),
        source: row.source,
        sku: row.sku,
        activity_at: row.activity_at,
      }));
      fixture.breakdownRowsForRequest = ({ args }) => [
        typeBucket("PRODUCT_SALES", args.p_date_from === "2026-11-07" ? "100" : "13"),
      ];
      await signIn(page);
      const rows = page
        .getByRole("table", { name: "Financial records", exact: true })
        .locator('tbody [data-column="sku"]');
      await expect(rows).toHaveText([
        "NEXT-UTC-DAY-001",
        "JP-KIOSK-001",
        "JP-FINANCE-001",
        "US-KIOSK-001",
        "US-FINANCE-001",
      ]);
      const transactionTable = page.getByRole("table", { name: "Financial records", exact: true });
      await expect(
        transactionTable.getByRole("columnheader", { name: /^Date \(UTC\)/ }),
      ).toBeVisible();
      const financeTime = rowWithSku(page, "US-FINANCE-001").locator("time");
      await expect(financeTime).toHaveText("2026-11-06 07:57:20");
      await expect(financeTime.locator(".transaction-date")).toHaveText("2026-11-06");
      await expect(financeTime.locator(".transaction-clock")).toHaveText("07:57:20");
      expect(
        await financeTime.evaluate((element) => {
          const date = element.querySelector(".transaction-date");
          const time = element.querySelector(".transaction-clock");
          return (
            element.children.length === 2 &&
            date.getBoundingClientRect().bottom <= time.getBoundingClientRect().top &&
            parseFloat(globalThis.getComputedStyle(date).fontSize) >
              parseFloat(globalThis.getComputedStyle(time).fontSize) &&
            globalThis.getComputedStyle(date).color !== globalThis.getComputedStyle(time).color
          );
        }),
      ).toBe(true);
      await expect(financeTime).toHaveAttribute("datetime", "2026-11-06T07:57:20.000000Z");
      await expect(financeTime).toHaveAttribute("title", "2026-11-06T07:57:20.000000Z");
      await expect(transactionTable.locator("time").filter({ hasText: "UTC" })).toHaveCount(0);
      await expect(rowWithSku(page, "US-KIOSK-001").locator("time")).toHaveAttribute(
        "aria-description",
        "Assumed end of 2026-11-05 in Amazon.com's local time zone",
      );
      await expect(rowWithSku(page, "US-KIOSK-001").locator("time")).toHaveAttribute(
        "datetime",
        "2026-11-06T07:59:59.999999Z",
      );
      await expect(rowWithSku(page, "US-KIOSK-001").locator("time")).toHaveAttribute(
        "title",
        "2026-11-06T07:59:59.999999Z",
      );
      await expect(rowWithSku(page, "US-KIOSK-001").locator("time")).toHaveText(
        "2026-11-06 07:59:59",
      );
      await sortBy(page, "Date (UTC)", "Oldest first");
      await expect(rows).toHaveText([
        "US-FINANCE-001",
        "US-KIOSK-001",
        "JP-FINANCE-001",
        "JP-KIOSK-001",
        "NEXT-UTC-DAY-001",
      ]);
      await applyDates(page, "2026-11-06", "2026-11-06");
      await expect(rows).toHaveText([
        "US-FINANCE-001",
        "US-KIOSK-001",
        "JP-FINANCE-001",
        "JP-KIOSK-001",
      ]);

      await expect(
        summaryAmount(summaryPeriods(page, "Amazon.com").selected, "Reported amount"),
      ).toHaveText("13.00 USD");

      await expect(
        summaryAmount(summaryPeriods(page, "Amazon.co.jp").selected, "Reported amount"),
      ).toHaveText("24.00 USD");
      expect(fixture.requests.at(-1).args).toMatchObject({
        p_date_from: "2026-11-06",
        p_date_to: "2026-11-06",
      });
      expect(fixture.countRequests.at(-1).args).toMatchObject({
        p_date_from: "2026-11-06",
        p_date_to: "2026-11-06",
      });
      const selectedRequests = fixture.aggregateRequests.filter(
        ({ args }) => args.p_date_from === "2026-11-06" && args.p_date_to === "2026-11-06",
      );
      expect(selectedRequests.length).toBeGreaterThan(0);
      expect(selectedRequests.at(-1).args).toMatchObject({
        p_date_from: "2026-11-06",
        p_date_to: "2026-11-06",
      });
      const us = summaryPeriods(page, "Amazon.com");

      await expect(summaryCard(page, "Last day")).toContainText("Nov 6, 2026");

      await expect(summaryAmount(us.day, "Reported amount")).toHaveText("13.00 USD");
      await page.screenshot({
        path: testInfo.outputPath("utc-transactions.png"),
        fullPage: true,
        animations: "disabled",
      });
      for (const [periodRows, title, date, total, skus] of [
        [us.day, "Last day", "2026-11-06", "13.00 USD", ["US-KIOSK-001", "US-FINANCE-001"]],
        [
          us.selected,
          "Selected dates",
          "2026-11-06",
          "13.00 USD",
          ["US-KIOSK-001", "US-FINANCE-001"],
        ],
      ]) {
        await periodRows
          .getByRole("button", {
            name: `View ${title} for Amazon.com in USD by type`,
            exact: false,
          })
          .click();
        const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
        await expect(
          summaryAmount(
            dialog.getByRole("region", { name: "Breakdown total", exact: true }),
            "Reported amount",
          ),
        ).toHaveText(total);
        expect(fixture.breakdownRequests.at(-1).args).toMatchObject({
          p_date_from: date,
          p_date_to: date,
        });
        const records = dialog.getByRole("table", { name: "Amount records", exact: true });
        await expect(
          records.getByRole("columnheader", { name: "Date (UTC)", exact: true }),
        ).toBeVisible();
        await expect(records.locator("tbody tr")).toHaveCount(skus.length);
        for (const sku of skus) await expect(records).toContainText(sku);
        await expect(records.locator("time").filter({ hasText: "UTC" })).toHaveCount(0);
        for (const sku of skus) {
          const instant = fixture.liveRows.find((row) => row.sku === sku).activity_at;
          const time = records
            .getByRole("row")
            .filter({ has: page.getByRole("cell", { name: sku, exact: true }) })
            .locator("time");
          await expect(time).toHaveAttribute("datetime", instant);
          await expect(time).toHaveAttribute("title", instant);
          await expect(time).toHaveText(instant.slice(0, 19).replace("T", " "));
        }
        expect(fixture.summaryRecordRequests.at(-1).args).toMatchObject({
          p_date_from: date,
          p_date_to: date,
        });
        await dialog.getByRole("button", { name: "Close breakdown", exact: true }).click();
      }
      // Matching Selected dates and Last day reuse the same exact breakdown.
      expect(fixture.breakdownRequests).toHaveLength(1);
      // The latest UTC day remains selectable without moving the previous-day card.
      await applyDates(page, "2026-11-07", "2026-11-07");

      await expect(summaryAmount(us.selected, "Reported amount")).toHaveText("100.00 USD");

      await us.selected
        .getByRole("button", {
          name: "View Selected dates for Amazon.com in USD by type",
          exact: false,
        })
        .click();
      const shared = page.getByRole("dialog", { name: "Amounts by type", exact: true });
      await expect(
        summaryAmount(
          shared.getByRole("region", { name: "Breakdown total", exact: true }),
          "Reported amount",
        ),
      ).toHaveText("100.00 USD");
      await expect(
        shared.getByRole("table", { name: "Amount records", exact: true }),
      ).toContainText("NEXT-UTC-DAY-001");
      expect(fixture.breakdownRequests).toHaveLength(2);
      await expect(summaryCard(page, "Last day")).toContainText("Nov 6, 2026");
    });
  });
}

test.describe("source tables share the UTC transaction timeline", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("Finances and Data Kiosk display and filter UTC instants while retaining source dates", async ({
    page,
  }) => {
    const { financesRow, kioskRow } = await import("./api-fixtures.mjs");
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.financesRows = [
      {
        ...financesRow(1),
        sku: "FINANCE-START",
        posted_date: "2026-11-05",
        posted_at: "2026-11-06T00:00:00Z",
      },
      {
        ...financesRow(2),
        sku: "FINANCE-END",
        posted_date: "2026-11-06",
        posted_at: "2026-11-06T23:59:59Z",
      },
      {
        ...financesRow(3),
        sku: "FINANCE-NEXT",
        posted_date: "2026-11-06",
        posted_at: "2026-11-07T00:00:00Z",
      },
    ];
    fixture.kioskRows = [
      { ...kioskRow(1, "10"), sku: "KIOSK-US", activity_date: "2026-11-05" },
      {
        ...kioskRow(2, "20"),
        sku: "KIOSK-JP",
        activity_date: "2026-11-06",
        marketplace_name: "Amazon.co.jp",
      },
      { ...kioskRow(3, "30"), sku: "KIOSK-NEXT", activity_date: "2026-11-06" },
    ];
    fixture.assignments = skuAssignments(
      [...fixture.financesRows, ...fixture.kioskRows].map(({ sku }) => sku),
    );
    await signIn(page);
    for (const [dataset, tab, skus, times] of [
      [
        "finances",
        "Finances",
        ["FINANCE-START", "FINANCE-END"],
        ["2026-11-06 00:00:00", "2026-11-06 23:59:59"],
      ],
      [
        "data_kiosk",
        "Data Kiosk",
        ["KIOSK-US", "KIOSK-JP"],
        ["2026-11-06 07:59:59", "2026-11-06 14:59:59"],
      ],
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const table = page.getByRole("table", { name: "Financial records", exact: true });
      await expect(table.getByRole("columnheader", { name: /^Date \(UTC\)/ })).toBeVisible();
      await sortBy(page, "Date (UTC)", "Oldest first");
      await applyDates(page, "2026-11-06", "2026-11-06");
      await expect(table.locator('tbody [data-column="sku"]')).toHaveText(skus);
      await expect(table.locator("tbody time")).toHaveText(times);
      await expect(table.locator("tbody .transaction-date")).toHaveText(
        times.map((value) => value.split(" ")[0]),
      );
      await expect(table.locator("tbody .transaction-clock")).toHaveText(
        times.map((value) => value.split(" ")[1]),
      );
      expect(
        await table
          .locator('tbody [data-column="activity_at"]')
          .first()
          .evaluate((cell) => cell.getBoundingClientRect().width),
      ).toBeLessThan(150);
      await expect(table.locator("tbody time").filter({ hasText: "UTC" })).toHaveCount(0);
      expect(fixture.requests.at(-1).args).toMatchObject({
        p_dataset: dataset,
        p_date_from: "2026-11-06",
        p_date_to: "2026-11-06",
        p_order_by: "date",
        p_direction: "asc",
      });
      expect(fixture.countRequests.at(-1).count).toBe(2);
      await expect(page.getByRole("group", { name: "Applied table filters" })).toContainText(
        "Date (UTC): 2026-11-06 – 2026-11-06",
      );
      if (dataset === "data_kiosk") {
        await expect(table.locator("tbody .transaction-clock").first()).toHaveAttribute(
          "title",
          "Assumed end of 2026-11-05 in Amazon.com's local time zone",
        );
        await expect(table.locator("tbody time").first()).toHaveAttribute(
          "datetime",
          "2026-11-06T07:59:59.999999Z",
        );
      }
    }
  });
});
