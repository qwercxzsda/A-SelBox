import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourceComparisons,
  differenceExact,
  sumCompleteDecimals,
  applyComparisonCoverage,
  requireReportDiagnosticScope,
  sameSourceRevision,
} from "../src/source-diagnostics.ts";

function totals(rows, coverage) {
  return {
    scope: {
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      marketplace_name: "Amazon.com",
      currency: "USD",
    },
    revision: null,
    grouping: "total",
    rows: rows.map(([source, category, amount]) => ({
      seller_namespace: null,
      period: null,
      marketplace_name: "Amazon.com",
      currency: "USD",
      source,
      category,
      amount,
      row_count: "1",
    })),
    coverage:
      coverage ??
      ["FINANCES", "DATA_KIOSK"].map((source) => ({
        source,
        seller_namespace: "A",
        start_date: "2026-07-01",
        end_date: "2026-07-31",
      })),
    totalCount: 1,
    nextOffset: null,
  };
}

test("current and saved diagnostics share exact source/category arithmetic beyond Number precision", () => {
  const result = totals([
    ["FINANCES", "DATA_KIOSK", "9007199254740993.000000000000000001"],
    ["DATA_KIOSK", "DATA_KIOSK", "9007199254740993.000000000000000002"],
    ["FINANCES", "FINANCES", "500"],
  ]);
  const [row] = buildSourceComparisons(result, "DATA_KIOSK");
  assert.equal(row.difference, "-0.000000000000000001");
  assert.equal(row.finances_amount, result.rows[0].amount);
  assert.equal(differenceExact("-2.00", "-3"), "1");
  assert.equal(differenceExact("0", "-0.000"), "0");
  assert.equal(differenceExact("1", null), null);
});

test("an absent source is zero only with complete retrieval coverage", () => {
  const result = totals([["FINANCES", "DATA_KIOSK", "3"]]);
  assert.equal(buildSourceComparisons(result, "DATA_KIOSK")[0].difference, "3");
  result.coverage = result.coverage.filter((item) => item.source === "FINANCES");
  const [unknown] = buildSourceComparisons(result, "DATA_KIOSK");
  assert.equal(unknown.data_kiosk_amount, null);
  assert.equal(unknown.difference, null);
  assert.equal(unknown.data_kiosk_row_count, null);
});

test("coverage-only sellers and gaps prevent false zero counterparts", () => {
  const result = totals([["FINANCES", "DATA_KIOSK", "3"]]);
  result.coverage.push({ ...result.coverage[0], seller_namespace: "B" });
  assert.equal(buildSourceComparisons(result, "DATA_KIOSK")[0].data_kiosk_amount, null);
  result.coverage.push({ ...result.coverage[1], seller_namespace: "B", end_date: "2026-07-15" });
  result.coverage.push({ ...result.coverage[1], seller_namespace: "B", start_date: "2026-07-17" });
  assert.equal(buildSourceComparisons(result, "DATA_KIOSK")[0].data_kiosk_amount, null);
  result.coverage.push({
    ...result.coverage[1],
    seller_namespace: "B",
    start_date: "2026-07-16",
    end_date: "2026-07-16",
  });
  assert.equal(buildSourceComparisons(result, "DATA_KIOSK")[0].data_kiosk_amount, "0");
});

test("unknown monthly values do not become partial headline or running totals", () => {
  assert.equal(sumCompleteDecimals(["1", null, "3"]), null);
  assert.equal(sumCompleteDecimals(["1.25", "-0.25"]), "1");
  const result = totals([["FINANCES", "DATA_KIOSK", "1"]], []);
  const [family] = applyComparisonCoverage(
    [
      {
        month: null,
        finances_amount: "1",
        data_kiosk_amount: "0",
        finances_row_count: "1",
        data_kiosk_row_count: "0",
        difference: "1",
      },
    ],
    result,
  );
  assert.equal(family.difference, null);
  assert.equal(family.data_kiosk_row_count, null);
});

test("daily buckets stay independent across sellers and currencies", () => {
  const result = totals([
    ["FINANCES", "DATA_KIOSK", "4"],
    ["DATA_KIOSK", "DATA_KIOSK", "3"],
  ]);
  result.grouping = "day";
  result.rows[0] = { ...result.rows[0], seller_namespace: "A", period: "2026-07-01" };
  result.rows[1] = {
    ...result.rows[1],
    seller_namespace: "B",
    period: "2026-07-01",
    currency: "EUR",
  };
  const rows = buildSourceComparisons(result, "DATA_KIOSK");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].difference, "4");
  assert.equal(rows[1].difference, null);
});

test("fully retrieved empty summaries show zero only in an explicitly known currency", () => {
  const result = totals([]);
  result.totalCount = 0;
  const [row] = buildSourceComparisons(result, "DATA_KIOSK");
  assert.equal(row.finances_amount, "0");
  assert.equal(row.data_kiosk_amount, "0");
  assert.equal(row.difference, "0");
  assert.equal(row.finances_row_count, "0");
  result.grouping = "month";
  assert.equal(buildSourceComparisons(result, "DATA_KIOSK")[0].month, "2026-07-01");
  result.grouping = "day";
  assert.deepEqual(buildSourceComparisons(result, "DATA_KIOSK"), []);
  result.grouping = "total";
  result.coverage = result.coverage.filter((item) => item.source === "FINANCES");
  const [partial] = buildSourceComparisons(result, "DATA_KIOSK");
  assert.equal(partial.finances_amount, "0");
  assert.equal(partial.data_kiosk_amount, null);
  assert.equal(partial.difference, null);
  result.coverage = [];
  assert.deepEqual(buildSourceComparisons(result, "DATA_KIOSK"), []);
  const unknownCurrency = totals([]);
  unknownCurrency.scope.currency = null;
  assert.deepEqual(buildSourceComparisons(unknownCurrency, "DATA_KIOSK"), []);
});

test("saved scope and current revision matches include every comparison input", () => {
  const result = totals([]);
  result.scope.report_id = "saved-report";
  requireReportDiagnosticScope(result, result.scope);
  for (const [key, value] of [
    ["currency", "EUR"],
    ["marketplace_name", "Amazon.ca"],
    ["start_date", "2026-07-02"],
    ["end_date", "2026-07-30"],
    ["report_id", "another-report"],
  ])
    assert.throws(() => requireReportDiagnosticScope(result, { ...result.scope, [key]: value }));
  const first = { revision: { finances: "f1", data_kiosk: "k1" } };
  assert.equal(sameSourceRevision(first, first), true);
  assert.equal(
    sameSourceRevision(first, { revision: { finances: "f2", data_kiosk: "k1" } }),
    false,
  );
  assert.equal(sameSourceRevision(first, undefined), false);
});
