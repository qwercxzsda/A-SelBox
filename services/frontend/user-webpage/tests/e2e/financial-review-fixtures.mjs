import { expect } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

export const reviewRowId = (index) => `0198b50b-701a-7000-8000-${String(index).padStart(12, "0")}`;

/** One months RPC row. A month balances when its FINANCES row equals the other measures added. */
export function reviewMeasure(month, measure, base, tax, code = null, count = 1, extra = {}) {
  return {
    month: `${month}-01`,
    currency: "USD",
    measure,
    reason: measure === "DIFFERENCE" ? code : null,
    selbox_group: measure === "SELBOX" ? code : null,
    base_amount: base,
    tax_amount: tax,
    amount_count: String(count),
    ...extra,
  };
}

/**
 * Amazon.com in 2025. January and February have differences, March has no activity and April has
 * only Company and SelBox amounts. Year totals: Finances -171.8002 (tax -15.8), Company -165
 * (tax -15), SelBox -3.5 (tax -0.5), Differences -3.3002 (tax -0.3).
 */
const REVIEW_MONTHS = [
  reviewMeasure("2025-01", "FINANCES", "-99.0002", "-9.9", null, 14),
  reviewMeasure("2025-01", "COMPANY", "-90", "-9", null, 10),
  reviewMeasure("2025-01", "SELBOX", "-5", "-0.5", "ACCOUNT_FEE"),
  reviewMeasure("2025-01", "DIFFERENCE", "-4", "-0.4", "NO_ASSIGNMENT", 2),
  reviewMeasure("2025-01", "DIFFERENCE", "-0.0002", "0", "ROUNDING"),
  reviewMeasure("2025-02", "FINANCES", "-49", "-4.9", null, 3),
  reviewMeasure("2025-02", "COMPANY", "-50", "-5"),
  reviewMeasure("2025-02", "DIFFERENCE", "3", "0.3", "NOT_IN_LEDGER"),
  reviewMeasure("2025-02", "DIFFERENCE", "-2", "-0.2", "NO_ASSIGNMENT"),
  reviewMeasure("2025-04", "FINANCES", "-8", "-1", null, 2),
  reviewMeasure("2025-04", "COMPANY", "-10", "-1"),
  reviewMeasure("2025-04", "SELBOX", "2", "0", "BALANCE_MOVEMENT"),
];

/** One outcome record as financial_outcome_page returns it. */
export function reviewOutcome(index, overrides = {}) {
  return {
    source: "FINANCES",
    source_row_id: reviewRowId(index),
    source_version_id: reviewRowId(index + 1000),
    marketplace_name: "Amazon.com",
    currency: "USD",
    posted_date: "2025-01-15",
    component_type: "STORAGE_FEES",
    outcome: "DIFFERENCE",
    reason: "NO_ASSIGNMENT",
    selbox_group: null,
    reference_id: null,
    sku: `SKU-${String(index).padStart(2, "0")}`,
    skus: "[]",
    fnsku: null,
    asin: null,
    base_amount: "-2",
    tax_amount: "-0.2",
    ...overrides,
  };
}

/** January's rounding record is a balancing entry (KEY), as the database computes it. */
const REVIEW_OUTCOMES = [
  reviewOutcome(1, { fnsku: "X000000001", asin: "B000000001" }),
  reviewOutcome(2, { source: "STORAGE", posted_date: "2025-01-10" }),
  reviewOutcome(3, {
    source: "KEY",
    reason: "ROUNDING",
    base_amount: "-0.0002",
    tax_amount: "0",
    sku: null,
  }),
  reviewOutcome(4, {
    posted_date: "2025-01-31",
    outcome: "SELBOX",
    reason: null,
    selbox_group: "ACCOUNT_FEE",
    component_type: "SUBSCRIPTION_FEES",
    sku: null,
    base_amount: "-5",
    tax_amount: "-0.5",
  }),
  reviewOutcome(5, {
    posted_date: "2025-02-03",
    reason: "NOT_IN_LEDGER",
    base_amount: "3",
    tax_amount: "0.3",
  }),
  reviewOutcome(6, { posted_date: "2025-02-04", base_amount: "-2", tax_amount: "-0.2" }),
];

export const reviewDrawer = (page, month) => page.getByRole("dialog", { name: month, exact: true });
export const monthsTable = (page) => page.getByRole("table", { name: "Months", exact: true });

/** Sign in as an administrator and open Financial review for one year. */
export async function openFinancialReview(page, { year = "2025", configure } = {}) {
  const fixture = await mockSupabase(page);
  fixture.roles["member-a"] = "administrator";
  fixture.reviewMonths = [...REVIEW_MONTHS];
  fixture.reviewOutcomes = [...REVIEW_OUTCOMES];
  configure?.(fixture);
  await signIn(page);
  await page.getByRole("tab", { name: "Financial review", exact: true }).click();
  await page.getByLabel("Year", { exact: true }).selectOption(year);
  await expect(page.getByText("Updating…", { exact: true })).toHaveCount(0);
  return fixture;
}
