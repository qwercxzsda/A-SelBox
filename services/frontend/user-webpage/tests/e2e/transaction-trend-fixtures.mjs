import { expect } from "@playwright/test";
import { liveRow, skuAssignments } from "./api-fixtures.mjs";
import { mockSupabase, signIn } from "./fixtures.mjs";
import { summaryBucket } from "./summary-fixtures.mjs";

export const TREND_COMPANY = "11111111-1111-4111-8111-111111111111";
export const trendRegion = (page, mode = "Daily") =>
  page.getByRole("region", { name: `${mode} trends`, exact: true });
export const trendChart = (page, currency = "USD", mode = "Daily") =>
  page.getByRole("figure", {
    name: new RegExp(`^${mode} company amount trend for .+ \\(${currency}\\)$`),
  });
export const chartPeriodSelect = (chart, period = "day") =>
  chart.getByRole("combobox", { name: new RegExp(`^Chart ${period} for `) });
export const selectedTrendAmount = (chart, field = "companyAmount") =>
  chart.locator(`.transaction-trend-selected-amounts [data-amount-field="${field}"] dd`);

export function trendBucket(
  date,
  amount,
  { type = "PRODUCT_SALES", sku = "ALPHA", ...options } = {},
) {
  const source = type === "FBA_STORAGE_FEE" ? "DATA_KIOSK" : "FINANCES";
  return {
    ...summaryBucket(date, amount, { category: source, ...options }),
    activity_at: `${date}T12:00:00.000000Z`,
    component_type: type,
    source,
    sku,
    company_id: TREND_COMPANY,
  };
}

export async function setupTrendPage(page, role = "member", extraRows = []) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = role;
  fixture.companyIds["member-a"] = TREND_COMPANY;
  fixture.companyNames[TREND_COMPANY] = "Trend Company";
  fixture.assignments = skuAssignments(["ALPHA", "BETA"], TREND_COMPANY);
  fixture.aggregateRows = [
    trendBucket("2026-11-15", "1"),
    trendBucket("2026-11-14", "100", { serviceFee: "-5", companyAmount: "95" }),
    trendBucket("2026-11-14", "-10", { type: "FBA_STORAGE_FEE" }),
    trendBucket("2026-11-13", "20", { sku: "BETA" }),
    trendBucket("2026-11-14", "30", { marketplace: "Amazon.ca", currency: "CAD" }),
    trendBucket("2026-11-14", "5", { currency: "EUR" }),
    trendBucket("2026-10-31", "70"),
    trendBucket("2026-10-31", "40", { marketplace: "Amazon.ca", currency: "CAD" }),
    ...extraRows,
  ];
  fixture.liveRows = fixture.aggregateRows.map((row, index) => ({
    ...liveRow("TREND", index + 1, TREND_COMPANY),
    ...row,
    source_amount: row.reported_amount,
    fee_amount: row.service_fee,
  }));
  await signIn(page);
  await expect(page.getByRole("region", { name: "Current totals", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  return fixture;
}
