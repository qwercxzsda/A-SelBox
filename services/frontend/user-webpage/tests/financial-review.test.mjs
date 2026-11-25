import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { marketplaceCurrency } from "../src/api/marketplace-currencies.ts";
import {
  legendReasons,
  projectDifferenceChart,
  stackReasons,
} from "../src/financial-review-chart.ts";
import { buildReviewYear } from "../src/financial-review-model.ts";
import {
  CLOSED_REVIEW_MONTH,
  FIRST_REVIEW_YEAR,
  decodeFinancialReviewView,
  reviewMonthCount,
  reviewYears,
  selectionFor,
} from "../src/financial-review-view.ts";
import marketplaces from "../src/generated/marketplaces.json" with { type: "json" };
import { locationPreference, workspaceLocation } from "../src/workspace-location.ts";
import { SETTINGS, csvRecord } from "./api-fixtures.mjs";

const NOW = new Date("2026-11-25T12:00:00Z");
const SCOPE = { marketplace: "Amazon.com", year: 2026, currency: "USD" };
const ROW_ID = "0198b50b-701a-7000-8000-000000000042";

/** A months RPC row in the decoded shape. */
function measure(month, kind, base, tax = "0", code = null, count = 1) {
  return {
    month,
    measure: kind,
    reason: kind === "DIFFERENCE" ? code : null,
    selboxGroup: kind === "SELBOX" ? code : null,
    baseAmount: base,
    taxAmount: tax,
    count,
  };
}

/** Reply with each requested column in PostgREST's alphabetical CSV header order. */
function csvClient(rowsFor, requests = []) {
  return createApiClient(SETTINGS, async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    const columns = parsed.searchParams.get("select").split(",");
    const lines = rowsFor(parsed).map(
      (row) =>
        csvRecord(Object.fromEntries(columns.map((field) => [field, row[field] ?? null]))).split(
          "\n",
        )[1],
    );
    return new Response([[...columns].sort().join(","), ...lines].join("\n"));
  });
}

const monthRow = (overrides) => ({
  month: "2026-04-01",
  currency: "USD",
  measure: "DIFFERENCE",
  reason: "ROUNDING",
  selbox_group: null,
  base_amount: "-0.0015",
  tax_amount: "0",
  amount_count: "3",
  ...overrides,
});

test("the months RPC takes the marketplace and year and decodes exact measures", async () => {
  const requests = [];
  const client = csvClient(
    () => [monthRow(), monthRow({ measure: "FINANCES", reason: null, base_amount: "14.9485" })],
    requests,
  );
  const rows = await client.fetchReviewMonths("access", { marketplace: "Amazon.com", year: 2026 });
  const params = requests[0].searchParams;
  assert.equal(requests[0].pathname, "/rest/v1/rpc/financial_review_months");
  assert.deepEqual(
    [params.get("p_marketplace"), params.get("p_year"), params.get("p_currency")],
    ["Amazon.com", "2026", null],
  );
  assert.equal(params.get("select"), params.get("select").split(",").sort().join(","));
  assert.deepEqual(rows[0], {
    month: "2026-04",
    measure: "DIFFERENCE",
    reason: "ROUNDING",
    selboxGroup: null,
    baseAmount: "-0.0015",
    taxAmount: "0",
    count: 3,
  });
  assert.equal(rows[1].baseAmount, "14.9485");
});

test("a months row outside the marketplace currency, the known codes or the year is rejected", async () => {
  for (const [overrides, message] of [
    [{ currency: "EUR" }, /returned EUR for Amazon.com, which charges in USD/],
    [{ reason: "SUBSCRIPTION" }, /Unknown difference reason/],
    [{ measure: "SELBOX", reason: null, selbox_group: "SUBSCRIPTION" }, /Unknown SelBox group/],
    [{ measure: "FINANCES" }, /reason or group for FINANCES/],
    [{ measure: "MISSING_FEE" }, /Unknown review measure/],
    [{ month: "2025-12-01" }, /outside 2026/],
    [{ amount_count: "-1" }, /invalid record count/],
  ]) {
    const client = csvClient(() => [monthRow(overrides)]);
    await assert.rejects(
      client.fetchReviewMonths("access", { marketplace: "Amazon.com", year: 2026 }),
      message,
    );
  }
});

test("a records page names its outcome, month, reason and exact offset", async () => {
  const requests = [];
  const record = {
    source: "FINANCES",
    source_row_id: ROW_ID,
    source_version_id: ROW_ID,
    marketplace_name: "Amazon.com",
    currency: "USD",
    posted_date: "2026-04-09",
    outcome: "DIFFERENCE",
    reason: "NO_ID_ON_CHARGE",
    skus: '["SKU-A","SKU-B"]',
    base_amount: "-0.0002",
    tax_amount: "0",
  };
  const filters = {
    outcome: "DIFFERENCE",
    marketplace: "Amazon.com",
    month: "2026-04",
    reason: "NO_ID_ON_CHARGE",
    selboxGroup: null,
  };
  const client = csvClient(() => [record], requests);
  const rows = await client.fetchFinancialOutcomes("access", filters, 1);
  const params = requests[0].searchParams;
  assert.deepEqual(Object.fromEntries([...params].filter(([key]) => key.startsWith("p_"))), {
    p_outcome: "DIFFERENCE",
    p_month: "2026-04-01",
    p_marketplace: "Amazon.com",
    p_limit: "50",
    p_offset: "50",
    p_reason: "NO_ID_ON_CHARGE",
  });
  assert.equal(params.get("order"), null);
  assert.equal(rows[0].sku, "SKU-A, SKU-B");
  for (const [overrides, message] of [
    [{ reason: "ROUNDING" }, /another reason/],
    [{ posted_date: "2026-05-01" }, /outside the selected month/],
    [{ currency: "CAD" }, /which charges in USD/],
    [{ source_row_id: null }, /without its source/],
    [{ source: "SETTLEMENT" }, /Unknown record source: SETTLEMENT/],
    [{ source: null }, /Unknown record source/],
  ]) {
    const invalid = csvClient(() => [{ ...record, ...overrides }]);
    await assert.rejects(invalid.fetchFinancialOutcomes("access", filters, 0), message);
  }
  // A balancing entry computed from a Finances charge is a known source.
  const balancing = csvClient(() => [{ ...record, source: "KEY" }]);
  assert.equal((await balancing.fetchFinancialOutcomes("access", filters, 0))[0].source, "KEY");
});

test("every marketplace has exactly one currency", () => {
  for (const marketplace of marketplaces)
    assert.match(marketplaceCurrency(marketplace), /^[A-Z]{3}$/);
  assert.deepEqual(["Amazon.com", "Amazon.de", "Amazon.co.jp"].map(marketplaceCurrency), [
    "USD",
    "EUR",
    "JPY",
  ]);
  assert.throws(() => marketplaceCurrency("Amazon.invalid"), /No currency/);
});

test("the review view keeps constant options and drops a month outside its year", () => {
  assert.deepEqual(decodeFinancialReviewView(null, NOW), {
    marketplace: "Amazon.com",
    year: 2026,
    month: "",
    reason: null,
    selboxGroup: null,
  });
  assert.deepEqual(
    decodeFinancialReviewView(
      { marketplace: "Amazon.de", year: "2025", month: "2025-04", reason: "ROUNDING" },
      NOW,
    ),
    {
      marketplace: "Amazon.de",
      year: 2025,
      month: "2025-04",
      reason: "ROUNDING",
      selboxGroup: null,
    },
  );
  const invalid = decodeFinancialReviewView(
    { marketplace: "Amazon.zz", year: 2031, month: "2025-04", reason: "SUBSCRIPTION" },
    NOW,
  );
  assert.deepEqual([invalid.marketplace, invalid.year, invalid.month], ["Amazon.com", 2026, ""]);
  assert.equal(decodeFinancialReviewView({ year: FIRST_REVIEW_YEAR - 1 }, NOW).year, 2026);
  assert.equal(decodeFinancialReviewView({ reason: "ROUNDING" }, NOW).reason, null);
  assert.deepEqual(reviewYears(NOW), [2026, 2025, 2024]);
  assert.deepEqual([reviewMonthCount(2025, NOW), reviewMonthCount(2026, NOW)], [12, 11]);
});

test("review scope and the open month round trip through the URL", () => {
  const admin = { user_id: "reviewer", access_role: "administrator", company_id: null };
  const year = new Date().getUTCFullYear();
  const view = {
    marketplace: "Amazon.de",
    year,
    month: `${String(year)}-01`,
    reason: "NOT_IN_LEDGER",
    selboxGroup: "ACCOUNT_FEE",
  };
  const url = workspaceLocation(
    new URL("https://example.test/"),
    admin,
    new Map([
      ["tab", "financial-review"],
      ["financial-review:view", view],
    ]),
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    tab: "financial-review",
    marketplace: "Amazon.de",
    year: String(year),
    row: view.month,
    reason: "NOT_IN_LEDGER",
    group: "ACCOUNT_FEE",
  });
  assert.deepEqual(locationPreference(url, admin, "financial-review:view", null), view);
});

test("the year balances month by month and accumulates the difference including tax", () => {
  const review = buildReviewYear(
    [
      measure("2026-01", "FINANCES", "-10", "-1", null, 4),
      measure("2026-01", "COMPANY", "-8", "-0.8", null, 2),
      measure("2026-01", "DIFFERENCE", "-2.5", "-0.2", "NOT_IN_LEDGER"),
      measure("2026-01", "DIFFERENCE", "0.5", "0", "NO_ASSIGNMENT"),
      measure("2026-03", "FINANCES", "3", "0"),
      measure("2026-03", "SELBOX", "3", "0", "ACCOUNT_FEE"),
    ],
    SCOPE,
  );
  assert.deepEqual(
    review.months.map(({ month }) => month),
    ["2026-01", "2026-03"],
  );
  const [january] = review.months;
  assert.deepEqual(january.totals.finances, { amount: "-11", tax: "-1" });
  assert.deepEqual(january.totals.difference, { amount: "-2.2", tax: "-0.2" });
  assert.deepEqual(
    january.reasons.map(({ code, amount, count }) => [code, amount, count]),
    [
      ["NO_ASSIGNMENT", "0.5", 1],
      ["NOT_IN_LEDGER", "-2.7", 1],
    ],
  );
  assert.deepEqual(
    review.months.map(({ runningDifference }) => runningDifference),
    ["-2.2", "-2.2"],
  );
  assert.deepEqual(review.totals.selbox, { amount: "3", tax: "0" });
  assert.deepEqual(
    legendReasons(review.reasons).map(({ code }) => code),
    ["NOT_IN_LEDGER", "NO_ASSIGNMENT"],
  );
});

test("a month whose outcomes differ from Finances fails, for base and for tax", () => {
  const rows = [
    measure("2026-04", "FINANCES", "-10", "-1"),
    measure("2026-04", "COMPANY", "-10", "-1"),
  ];
  assert.doesNotThrow(() => buildReviewYear(rows, SCOPE));
  assert.throws(
    () =>
      buildReviewYear(
        [...rows, measure("2026-04", "DIFFERENCE", "-0.0001", "0", "ROUNDING")],
        SCOPE,
      ),
    /April 2026 does not add up: Finances base -10.00 USD, but .* -10.0001 USD/,
  );
  assert.throws(
    () => buildReviewYear([rows[0], measure("2026-04", "COMPANY", "-10", "-0.99")], SCOPE),
    /Finances tax -1.00 USD/,
  );
  assert.throws(() => buildReviewYear([...rows, rows[1]], SCOPE), /repeated a monthly measure/);
});

test("reasons stack up and down from zero and the chart leaves inactive months as gaps", () => {
  const segments = stackReasons(
    [
      { code: "NO_ASSIGNMENT", amount: "2", tax: "0", count: 1 },
      { code: "ROUNDING", amount: "-3", tax: "0", count: 1 },
      { code: "NOT_IN_LEDGER", amount: "1", tax: "0", count: 1 },
    ],
    "0",
  );
  assert.deepEqual(
    segments.map(({ start, end }) => [start, end]),
    [
      ["0", "2"],
      ["0", "-3"],
      ["2", "3"],
    ],
  );
  assert.throws(
    () => stackReasons([{ code: "ROUNDING", amount: "1", tax: "0", count: 1 }], "2"),
    /differ from the monthly difference/,
  );
  const review = buildReviewYear(
    [
      measure("2026-02", "FINANCES", "-3"),
      measure("2026-02", "DIFFERENCE", "-3", "0", "ROUNDING"),
      measure("2026-04", "FINANCES", "1"),
      measure("2026-04", "DIFFERENCE", "1", "0", "CHARGED_IN_ANOTHER_MONTH"),
    ],
    SCOPE,
  );
  const chart = projectDifferenceChart(review, 5);
  assert.deepEqual(
    chart.points.map((point) => point?.month ?? null),
    [null, "2026-02", null, "2026-04", null],
  );
  assert.deepEqual(chart.reasons, ["ROUNDING", "CHARGED_IN_ANOTHER_MONTH"]);
  const [february, april] = [chart.points[1], chart.points[3]];
  assert.equal(february.segments[0].top, chart.zero);
  assert.ok(Math.abs(april.segments[0].top + april.segments[0].height - chart.zero) < 1e-9);
  assert.deepEqual([february.runningDifference, april.runningDifference], ["-3", "-2"]);
  assert.equal(chart.lines.length, 2, "an inactive month breaks the running line");
  const balanced = buildReviewYear(
    [measure("2026-01", "FINANCES", "5"), measure("2026-01", "COMPANY", "5")],
    SCOPE,
  );
  assert.equal(projectDifferenceChart(balanced, 12), null);
});

test("a reason that nets to zero over the year still charts its months", () => {
  // Charged in another month: the charge's month and the report's month balance each other.
  const review = buildReviewYear(
    [
      measure("2026-01", "FINANCES", "0"),
      measure("2026-01", "COMPANY", "-5"),
      measure("2026-01", "DIFFERENCE", "5", "0", "CHARGED_IN_ANOTHER_MONTH"),
      measure("2026-02", "FINANCES", "0"),
      measure("2026-02", "COMPANY", "5"),
      measure("2026-02", "DIFFERENCE", "-5", "0", "CHARGED_IN_ANOTHER_MONTH"),
    ],
    SCOPE,
  );
  assert.deepEqual(
    review.reasons.map(({ code, amount }) => [code, amount]),
    [["CHARGED_IN_ANOTHER_MONTH", "0"]],
  );
  const chart = projectDifferenceChart(review, 2);
  assert.ok(chart, "the chart is empty only when every month is zero");
  assert.deepEqual(
    chart.points.map((point) => [point.difference, point.segments.length]),
    [
      ["5", 1],
      ["-5", 1],
    ],
  );
  const zero = buildReviewYear(
    [measure("2026-01", "FINANCES", "0"), measure("2026-01", "DIFFERENCE", "0", "0", "ROUNDING")],
    SCOPE,
  );
  assert.equal(projectDifferenceChart(zero, 1), null);
});

test("a month keeps only the reason and group it has; no month closes the drawer", () => {
  const review = buildReviewYear(
    [
      measure("2026-01", "FINANCES", "-3"),
      measure("2026-01", "SELBOX", "-1", "0", "ACCOUNT_FEE"),
      measure("2026-01", "DIFFERENCE", "-2", "0", "ROUNDING"),
      measure("2026-02", "FINANCES", "-2"),
      measure("2026-02", "DIFFERENCE", "-2", "0", "NO_ASSIGNMENT"),
    ],
    SCOPE,
  );
  const [january, february] = review.months;
  const selection = { month: "2026-01", reason: "ROUNDING", selboxGroup: "ACCOUNT_FEE" };
  assert.deepEqual(selectionFor(january, selection), selection);
  assert.deepEqual(selectionFor(february, selection), {
    month: "2026-02",
    reason: null,
    selboxGroup: null,
  });
  assert.deepEqual(selectionFor(undefined, selection), CLOSED_REVIEW_MONTH);
});
