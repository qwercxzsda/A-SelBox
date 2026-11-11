import assert from "node:assert/strict";
import test from "node:test";
import { summaryPeriods, previousMonthRange, selectedPeriod } from "../src/summary-periods.ts";

test("last month always precedes the latest transaction's UTC month, including month-end", () => {
  for (const [latest, from, to] of [
    ["2026-09-13", "2026-08-01", "2026-08-31"],
    ["2026-08-31", "2026-07-01", "2026-07-31"],
    ["2026-11-30", "2026-10-01", "2026-10-31"],
    ["2026-01-02", "2025-12-01", "2025-12-31"],
    ["2026-01-31", "2025-12-01", "2025-12-31"],
    ["2024-02-29", "2024-01-01", "2024-01-31"],
    ["2024-02-28", "2024-01-01", "2024-01-31"],
    ["2025-02-28", "2025-01-01", "2025-01-31"],
    ["2024-03-31", "2024-02-01", "2024-02-29"],
    ["2025-03-31", "2025-02-01", "2025-02-28"],
  ])
    assert.deepEqual(previousMonthRange(latest), { from, to });
});

test("period definitions use the day before the latest data date and need transactions", () => {
  assert.deepEqual(summaryPeriods(null), { day: null, month: null });
  const periods = summaryPeriods("2026-09-13");
  assert.deepEqual(periods.day, {
    label: "Sep 12, 2026",
    range: { from: "2026-09-12", to: "2026-09-12" },
  });
  assert.deepEqual(periods.month, {
    label: "August 2026",
    range: { from: "2026-08-01", to: "2026-08-31" },
  });
});

test("last day crosses UTC month, year, and leap-day boundaries", () => {
  for (const [latest, previous] of [
    ["2026-11-01", "2026-10-31"],
    ["2026-01-01", "2025-12-31"],
    ["2024-03-01", "2024-02-29"],
    ["2025-03-01", "2025-02-28"],
  ]) {
    const periods = summaryPeriods(latest);
    assert.deepEqual(periods.day.range, { from: previous, to: previous });
    assert.deepEqual(periods.month.range, previousMonthRange(latest));
  }
});

test("selected dates require a bound and preserve inclusive, single-day, and open ranges", () => {
  assert.equal(selectedPeriod({ from: "", to: "" }), null);
  for (const [from, to, label] of [
    ["2026-02-01", "2026-02-28", "Feb 1, 2026 – Feb 28, 2026"],
    ["2026-03-01", "", "From Mar 1, 2026"],
    ["", "2026-02-28", "Through Feb 28, 2026"],
    ["2026-03-01", "2026-03-01", "Mar 1, 2026"],
  ]) {
    assert.deepEqual(selectedPeriod({ from, to }), { label, range: { from, to } });
  }
});
