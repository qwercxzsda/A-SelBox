import { expect, test } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { applyDates } from "./table-actions.mjs";
import { timestampedTransaction } from "./transaction-time-fixtures.mjs";
import {
  summaryAmount,
  summaryBucket,
  summaryCard,
  summaryPeriods,
  typeBucket,
} from "./summary-fixtures.mjs";

const COMPANY = "11111111-1111-4111-8111-111111111111";

function transaction(prefix, index, amount, category, fee, date = "2026-10-10") {
  const row = {
    ...liveRow(prefix, index, category === "SELBOX" ? null : COMPANY),
    category,
    activity_date: date,
    activity_at: category === "DATA_KIOSK" ? undefined : `${date}T12:00:00.000000Z`,
    source: category === "DATA_KIOSK" ? "DATA_KIOSK" : "FINANCES",
    component_type:
      category === "DATA_KIOSK"
        ? "STORAGE_FEES"
        : category === "SELBOX"
          ? "DEBT_RECOVERY"
          : "PRODUCT_SALES",
    source_amount: amount,
    fee_amount: fee,
    company_amount:
      category === "SELBOX" ? "0" : fee === null ? null : String(Number(amount) + Number(fee)),
    fee_base: category === "FINANCES" ? amount : null,
    fee_rate_percent: category === "FINANCES" && fee !== null ? "5" : null,
    resolution_status:
      fee === null ? "MISSING_FEE" : category === "FINANCES" ? "APPLIED" : "NOT_APPLICABLE",
  };
  return timestampedTransaction(row);
}

function aggregate(row) {
  return {
    ...summaryBucket(row.activity_date, row.source_amount, {
      marketplace: row.marketplace_name,
      currency: row.currency,
      category: row.category,
      serviceFee: row.fee_amount,
      companyAmount: row.company_amount,
      knownCompanyCount: row.company_amount === null ? 0 : 1,
    }),
    activity_at: row.activity_at,
    source: row.source,
    sku: row.sku,
    company_id: row.company_id,
  };
}

function breakdown(row) {
  return typeBucket(row.component_type, row.source_amount, {
    marketplace: row.marketplace_name,
    currency: row.currency,
    serviceFee: row.fee_amount,
    companyAmount: row.company_amount,
    knownCompanyCount: row.company_amount === null ? 0 : 1,
  });
}

for (const width of [1440, 390]) {
  test(`company totals exclude signed SelBox activity while the transaction list retains it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = "administrator";
    fixture.companyIds["member-a"] = COMPANY;
    fixture.companyNames[COMPANY] = "Company totals";
    const rows = [
      transaction("PRODUCT-SALE", 1, "100", "FINANCES", "-5"),
      transaction("STORAGE-COST", 2, "-20", "DATA_KIOSK", "0"),
      transaction("ACCOUNT-DEBT", 3, "50", "SELBOX", "0", "2026-10-15"),
      {
        ...transaction("ACCOUNT-SUBSCRIPTION", 4, "-10", "SELBOX", "0", "2026-10-16"),
        component_type: "SUBSCRIPTION_FEES",
      },
      {
        ...transaction("ACCOUNT-CANADA", 5, "60", "SELBOX", "0", "2026-10-17"),
        marketplace_name: "Amazon.ca",
        currency: "CAD",
      },
      transaction("LATEST-ACCOUNT-DEBT", 6, "1", "SELBOX", "0", "2026-11-06"),
    ];
    fixture.liveRows = rows;
    fixture.assignments = skuAssignments(
      rows.filter((row) => row.category !== "SELBOX").map((row) => row.sku),
      COMPANY,
    );
    fixture.aggregateRows = rows.map(aggregate);
    fixture.breakdownRows = rows.slice(0, 5).map(breakdown);
    fixture.aggregatePageCap = 1;
    fixture.breakdownPageCap = 1;
    await signIn(page);

    // The latest transaction still determines the global UTC anchor, even if it belongs to SelBox.
    await expect(
      summaryCard(page, "Last day").getByRole("button", {
        name: "Filter transactions to Nov 5, 2026 · UTC",
        exact: true,
      }),
    ).toBeVisible();
    const totals = summaryPeriods(page);
    await expect(totals.day).toContainText("No transactions");
    for (const [label, expected] of [
      ["Reported amount", "80.00 USD"],
      ["Service fee", "-5.00 USD"],
      ["Company amount", "75.00 USD"],
    ])
      await expect(summaryAmount(totals.month, label)).toHaveText(expected);
    await expect(totals.month.locator("[data-record-count]")).toHaveAttribute(
      "data-record-count",
      "2",
    );
    await expect(summaryPeriods(page, "Amazon.ca").month).toContainText("No transactions");
    await expect(
      summaryPeriods(page, "Amazon.ca").month.locator("[data-amount-field]"),
    ).toHaveCount(0);

    const main = page.getByRole("table", { name: "Financial records", exact: true });
    await expect(main.locator("tbody tr")).toHaveCount(6);
    await expect(main).toContainText("ACCOUNT-DEBT-003");
    await expect(main).toContainText("ACCOUNT-SUBSCRIPTION-004");
    expect(fixture.latestRequests[0].args.p_include_selbox).not.toBe(false);
    expect(fixture.requests.at(-1).args.p_include_selbox).not.toBe(false);
    expect(fixture.countRequests.at(-1).args.p_include_selbox).not.toBe(false);

    await applyDates(page, "2026-10-01", "2026-10-31");
    await expect(summaryAmount(totals.selected, "Reported amount")).toHaveText("80.00 USD");
    await expect(main.locator("tbody tr")).toHaveCount(5);
    await page
      .getByRole("button", {
        name: "View Selected dates for Amazon.com in USD by type",
        exact: false,
      })
      .click();
    const dialog = page.getByRole("dialog", { name: "Amounts by type", exact: true });
    await expect(
      dialog.getByRole("region", { name: "Breakdown total", exact: true }).locator("dd"),
    ).toHaveText(["80.00 USD", "-5.00 USD", "75.00 USD"]);
    await expect(
      dialog.getByRole("region", { name: "Breakdown total", exact: true }),
    ).toContainText("2 records across 2 types");
    await expect(dialog).not.toContainText("Debt recovery");
    await expect(dialog).not.toContainText("Subscription fees");
    const records = dialog.getByRole("table", { name: "Amount records", exact: true });
    await expect(records.locator("tbody tr")).toHaveCount(2);
    await expect(records).toContainText("PRODUCT-SALE-001");
    await expect(records).toContainText("STORAGE-COST-002");
    await expect(records).not.toContainText("ACCOUNT-");
    expect(fixture.summaryRecordRequests.at(-1).args.p_include_selbox).toBe(false);
    expect(fixture.summaryRecordRequests.at(-1).args.p_types).toEqual([]);

    await dialog.getByRole("button", { name: "Sales and refunds details", exact: true }).click();
    await dialog
      .getByRole("button", { name: "View Sales and refunds records", exact: true })
      .click();
    await expect(records.locator("tbody tr")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Show all records", exact: true }).click();
    await expect(records.locator("tbody tr")).toHaveCount(2);
    expect(
      fixture.summaryRecordRequests.filter(({ args }) => args.p_include_selbox !== false),
    ).toEqual([]);
  });
}

test("excluding SelBox preserves partial company amounts and counts only uncalculated company records", async ({
  page,
}) => {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-a"] = COMPANY;
  const rows = [
    transaction("KNOWN", 1, "100", "FINANCES", "-5", "2026-10-31"),
    transaction("UNKNOWN-FEE", 2, "40", "FINANCES", null, "2026-10-31"),
    transaction("ACCOUNT-DEBT", 3, "500", "SELBOX", "0", "2026-11-01"),
  ];
  fixture.liveRows = rows;
  fixture.aggregateRows = rows.map(aggregate);
  await signIn(page);
  const totals = summaryPeriods(page).day;
  await expect(summaryAmount(totals, "Reported amount")).toHaveText("140.00 USD");
  await expect(summaryAmount(totals, "Service fee")).toHaveText("-5.00 USD");
  await expect(summaryAmount(totals, "Company amount")).toHaveText("95.00 USD");
  await expect(totals).toContainText("Known amount · 1 uncalculated");
  await expect(totals.locator("[data-record-count]")).toHaveAttribute("data-record-count", "2");
});
