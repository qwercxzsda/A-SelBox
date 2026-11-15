import assert from "node:assert/strict";
import test from "node:test";
import {
  transactionTrendPeriod,
  decodeTransactionSummaryView,
} from "../src/transaction-trend-periods.ts";

const noDates = { from: "", to: "" };
test("daily defaults are 30 complete UTC days across years and leap days", () => {
  for (const [latest, from, to] of [
    ["2026-11-15", "2026-10-16", "2026-11-14"],
    ["2026-01-01", "2025-12-02", "2025-12-31"],
    ["2024-03-01", "2024-01-31", "2024-02-29"],
  ])
    assert.deepEqual(transactionTrendPeriod(latest, "day", noDates).range, { from, to });
});

test("weekly defaults cover twelve complete calendar months, including month-end anchors", () => {
  for (const [latest, from, to] of [
    ["2026-11-15", "2025-11-01", "2026-10-31"],
    ["2026-11-30", "2025-11-01", "2026-10-31"],
    ["2024-03-31", "2023-03-01", "2024-02-29"],
    ["2026-01-01", "2025-01-01", "2025-12-31"],
  ])
    assert.deepEqual(transactionTrendPeriod(latest, "week", noDates).range, { from, to });
});

test("both modes honor explicit dates and one-sided filters even without an anchor", () => {
  for (const granularity of ["day", "week"]) {
    assert.equal(transactionTrendPeriod(null, granularity, noDates), null);
    for (const dates of [
      { from: "2026-01-01", to: "" },
      { from: "", to: "2025-12-31" },
      { from: "2026-11-01", to: "2026-11-10" },
    ])
      assert.deepEqual(transactionTrendPeriod(null, granularity, dates).range, dates);
  }
  assert.equal(decodeTransactionSummaryView("week"), "week");
  assert.equal(decodeTransactionSummaryView("invalid"), "totals");
});
