import { expect, test } from "@playwright/test";
import { mockSupabase, signIn, captureResponsiveReview } from "./fixtures.mjs";
import { liveRow } from "./api-fixtures.mjs";
import { summaryBucket, typeBucket, summaryAmount } from "./summary-fixtures.mjs";

const reportId = "0198b50b-701a-7000-8000-000000000002";
const companyId = "0198b50b-701a-7000-8000-000000000001";

for (const width of [834, 390]) {
  test(`UTC month and payout records inside both periods share totals and drilldowns at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 1112 });
    const fixture = await mockSupabase(page);
    fixture.companyIds["member-a"] = companyId;
    fixture.companyNames[companyId] = "Monthly Company";
    const precise = "100.123456789012345678";
    fixture.aggregateRows = [
      summaryBucket("2026-07-01", "0"),
      summaryBucket("2026-06-30", precise, {
        serviceFee: "-5",
        companyAmount: "95.123456789012345678",
        rowCount: 54,
      }),
    ];
    fixture.breakdownRows = [
      typeBucket("PRODUCT_SALES", "102.123456789012345678", {
        serviceFee: "-5",
        companyAmount: "97.123456789012345678",
        rowCount: 52,
      }),
      typeBucket("FBA_STORAGE_FEE", "-2", { rowCount: 2 }),
    ];
    fixture.liveRows = Array.from({ length: 52 }, (_, index) => ({
      ...liveRow("MONTH", index, companyId),
      source_row_id: `row-${String(index).padStart(3, "0")}`,
      sku: `SKU-${index}`,
      activity_date: "2026-06-30",
      component_type: "PRODUCT_SALES",
      source_amount: index === 0 ? "51.123456789012345678" : "1",
      fee_amount: index === 0 ? "-5" : "0",
      company_amount: index === 0 ? "46.123456789012345678" : "1",
      seller_namespace: index % 2 ? "seller-one" : "seller-two",
    }));
    fixture.liveRows.push({
      ...liveRow("STORAGE", 53, companyId),
      activity_date: "2026-06-29",
      component_type: "FBA_STORAGE_FEE",
      source: "DATA_KIOSK",
      source_amount: "-2",
      fee_amount: "0",
      company_amount: "-2",
    });
    fixture.payoutRows = [
      {
        id: reportId,
        company_id: companyId,
        currency: "USD",
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        created_at: "2026-09-27",
        source_amount: precise,
        fee_amount: "-5",
        company_amount: "95.123456789012345678",
      },
    ];
    fixture.liveRows.push({
      ...liveRow("ZERO-STORAGE", 55, companyId),
      activity_date: "2026-06-29",
      component_type: "FBA_STORAGE_FEE",
      source: "DATA_KIOSK",
      source_amount: "0",
      fee_amount: "0",
      company_amount: "0",
    });
    fixture.payoutRecords = fixture.liveRows.map((row) => ({
      ...row,
      report_id: reportId,
      authoritative: "true",
    }));
    fixture.liveRows.push({
      ...liveRow("EXCLUDED-EUR", 54, companyId),
      activity_date: "2026-06-30",
      currency: "EUR",
    });
    await signIn(page);

    await page
      .getByRole("button", { name: "View Last month for Amazon.com in USD by type", exact: false })
      .click();
    const summary = page.getByRole("dialog", { name: "Transaction totals", exact: true });
    const expectedAmounts = ["100.12 USD", "-5.00 USD", "95.12 USD"];
    const total = summary.getByRole("region", { name: "Breakdown total", exact: true });
    await expect(total.locator("dd")).toHaveText(expectedAmounts);
    const records = summary.getByRole("table", { name: "Amount records", exact: true });
    await expect(records.getByRole("row")).toHaveCount(51);
    await expect(summary).not.toContainText("EXCLUDED-EUR");
    await summary.getByRole("button", { name: "Next records", exact: true }).click();
    await expect(records.getByRole("row")).toHaveCount(5);
    await summary.getByRole("button", { name: "Storage & inventory details", exact: true }).click();
    await summary
      .getByRole("button", { name: "View Storage & inventory records", exact: true })
      .click();
    await expect(records.getByRole("row")).toHaveCount(3);
    await expect(records).toContainText("STORAGE-053");
    await expect(records).toContainText("ZERO-STORAGE-055");
    await expect(summary.getByRole("heading", { name: "Records", exact: true })).toBeInViewport();
    await expect(
      summary.getByRole("region", { name: "Amount records", exact: true }),
    ).toBeFocused();
    await summary.getByRole("button", { name: "Back to amounts", exact: true }).click();
    await expect(
      summary.getByRole("heading", { name: "Amounts by type", exact: true, level: 4 }),
    ).toBeInViewport();
    await expect(summary.getByRole("button", { name: "Previous records" })).toBeDisabled();
    expect(fixture.summaryRecordRequests.at(-1).args.p_currency).toBe("USD");
    expect(fixture.summaryRecordRequests.at(-1).args.p_types).toEqual(["FBA_STORAGE_FEE"]);
    await summary.getByRole("button", { name: "Show all records", exact: true }).click();
    await expect(records.getByRole("row")).toHaveCount(51);
    await captureResponsiveReview(page, testInfo, "summary-month-records");
    await summary.getByRole("button", { name: "Close breakdown" }).click();
    await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
    await page.getByRole("cell", { name: "95.12 USD", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Payout report details", exact: true });
    const saved = report.getByRole("region", { name: "Breakdown total", exact: true });
    await expect(saved.locator("dd")).toHaveText(expectedAmounts);
    await expect(saved).toContainText("54 records across 2 types");
    await report.getByRole("button", { name: "Sales & refunds details", exact: true }).click();
    const sales =
      width > 720
        ? report.getByRole("row", { name: "Product sales amounts", exact: true })
        : report.getByRole("article", { name: "Product sales amounts", exact: true });
    if (width <= 720)
      await expect(summaryAmount(sales, "Reported amount")).toHaveText("102.12 USD");
    else await expect(sales).toContainText("102.12 USD");
    await report.getByRole("button", { name: "View Product sales records", exact: true }).click();
    await expect(report.getByRole("heading", { name: "Records", exact: true })).toBeInViewport();
    const savedRecords = report.getByRole("table", { name: "Amount records", exact: true });
    await expect(savedRecords.getByRole("row")).toHaveCount(51);
    await report.getByRole("button", { name: "Next records", exact: true }).click();
    await expect(savedRecords.getByRole("row")).toHaveCount(3);
    await expect(report).not.toContainText("seller-one");
    await expect(report).not.toContainText("seller-two");
    const bounds = await report.evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
    await captureResponsiveReview(page, testInfo, "payout-month-records");
    expect(errors).toEqual([]);
  });
}
