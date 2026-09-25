import assert from "node:assert/strict";
import test from "node:test";
import { summaryPeriods, estimateMonthRange, selectedPeriod } from "../src/estimated-periods.ts";

test("the latest transaction's month-end day selects that month, otherwise the previous month", () => {
  for (const [latest, from, to] of [
    ["2026-09-13", "2026-08-01", "2026-08-31"],
    ["2026-08-31", "2026-08-01", "2026-08-31"],
    ["2026-01-02", "2025-12-01", "2025-12-31"],
    ["2024-02-29", "2024-02-01", "2024-02-29"],
    ["2024-02-28", "2024-01-01", "2024-01-31"],
    ["2025-02-28", "2025-02-01", "2025-02-28"],
  ])
    assert.deepEqual(estimateMonthRange(latest), { from, to });
});

test("period definitions use the latest data date and have no default without transactions", () => {
  assert.deepEqual(summaryPeriods(null), { day: null, month: null });
  const periods = summaryPeriods("2026-09-13");
  assert.deepEqual(periods.day, {
    label: "Sep 13, 2026",
    range: { from: "2026-09-13", to: "2026-09-13" },
  });
  assert.deepEqual(periods.month, {
    label: "August 2026",
    range: { from: "2026-08-01", to: "2026-08-31" },
  });
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
