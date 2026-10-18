import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinancialReviewTimeline,
  createMonthlyReviewView,
  createReviewScope,
  decodeMonthlyReviewView,
  decodeReviewScope,
} from "../src/financial-review-view.ts";

const row = (month, difference, currency = "USD") => ({
  month: `${month}-01`,
  currency,
  difference,
  finances_amount: "100.004",
  data_kiosk_amount: "99.996",
});

test("review scope persists only the shared year and currency and defaults to latest year and USD", () => {
  assert.deepEqual(createReviewScope(), { year: "", currency: "USD" });
  assert.deepEqual(decodeReviewScope(null), createReviewScope());
  assert.deepEqual(
    decodeReviewScope({ year: "2024", currency: "JPY", rows: [row("2024-01", "999")] }),
    { year: "2024", currency: "JPY" },
  );
  for (const year of ["0001", "2026", "9999"])
    assert.deepEqual(decodeReviewScope({ year, currency: "EUR" }), { year, currency: "EUR" });
});

test("invalid persisted year or currency falls back independently without becoming a query filter", () => {
  for (const year of [null, 2026, "0000", "26", "02026", "2026-01", "2026,or=(id)"])
    assert.deepEqual(decodeReviewScope({ year, currency: "JPY" }), { year: "", currency: "JPY" });
  for (const currency of [null, 123, "", "usd", "USD,EUR", "US", "USD\0"])
    assert.deepEqual(decodeReviewScope({ year: "2026", currency }), {
      year: "2026",
      currency: "USD",
    });
});

test("monthly selection survives reload without retaining amounts or obsolete cursor state", () => {
  assert.deepEqual(createMonthlyReviewView(), { selectedMonth: null });
  assert.deepEqual(decodeMonthlyReviewView(null), createMonthlyReviewView());
  assert.deepEqual(
    decodeMonthlyReviewView({
      selectedMonth: "2024-09",
      pageIndex: 2,
      pageSize: 50,
      cursors: [null, { month: "2024-09", offset: 25 }],
      filterMonth: "2024-09",
      rows: [row("2024-09", "999")],
    }),
    { selectedMonth: "2024-09" },
  );
  for (const selectedMonth of [null, 202609, "2026-13", "2026-9", "2026-09-01", "0000-01"])
    assert.deepEqual(decodeMonthlyReviewView({ selectedMonth }), createMonthlyReviewView());
});

test("running difference includes each current month, preserves exact cancellation and source gaps, and never mutates rows", () => {
  const rows = Object.freeze([
    Object.freeze(row("2026-04", "0")),
    Object.freeze(row("2026-03", "-9007199254740993.123456788")),
    Object.freeze(row("2026-01", "9007199254740993.123456789")),
    Object.freeze(row("2026-02", "999", "JPY")),
  ]);
  const timeline = buildFinancialReviewTimeline(rows, "USD");
  assert.deepEqual(
    timeline.map(({ month }) => month),
    ["2026-01-01", "2026-03-01", "2026-04-01"],
  );
  assert.deepEqual(
    timeline.map(({ running_difference }) => running_difference),
    ["9007199254740993.123456789", "0.000000001", "0.000000001"],
  );
  assert.deepEqual(
    timeline.map(({ difference }) => difference),
    ["9007199254740993.123456789", "-9007199254740993.123456788", "0"],
  );
  assert.equal(timeline[0].finances_amount, "100.004");
  assert.equal(timeline[0].data_kiosk_amount, "99.996");
  assert.ok(rows.every((original) => !("running_difference" in original)));
  assert.equal(rows[0].month, "2026-04-01");
  assert.deepEqual(buildFinancialReviewTimeline(rows, "JPY")[0].running_difference, "999");
  assert.deepEqual(buildFinancialReviewTimeline(rows, "EUR"), []);
});

test("running amounts never round monthly values and each selected year starts without a prior balance", () => {
  assert.deepEqual(
    buildFinancialReviewTimeline([row("2026-01", "0.004"), row("2026-02", "0.004")], "USD").map(
      ({ running_difference }) => running_difference,
    ),
    ["0.004", "0.008"],
  );
  assert.equal(
    buildFinancialReviewTimeline([row("2027-01", "-2.005")], "USD")[0].running_difference,
    "-2.005",
  );
});

test("timeline rejects malformed months, duplicate months, mixed years and unknown differences", () => {
  for (const rows of [
    [{ ...row("2026-01", "1"), month: "2026-01-02" }],
    [{ ...row("2026-01", "1"), month: "2026-13-01" }],
    [{ ...row("2026-01", "1"), month: "2026-01-extra-01" }],
    [row("2026-01", "1"), row("2026-01", "2")],
    [row("2025-12", "1"), row("2026-01", "2")],
    [row("2026-01", null)],
    [row("2026-01", undefined)],
    [row("2026-01", "")],
    [row("2026-01", "not-money")],
  ])
    assert.throws(() => buildFinancialReviewTimeline(rows, "USD"));
  assert.throws(() => buildFinancialReviewTimeline([], "usd"));
});
