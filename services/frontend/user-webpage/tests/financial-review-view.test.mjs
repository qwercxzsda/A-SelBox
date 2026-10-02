import assert from "node:assert/strict";
import test from "node:test";
import { createMonthlyReviewView, decodeMonthlyReviewView } from "../src/financial-review-view.ts";

test("saved monthly review row size and advancing cursors survive reload", () => {
  const previous = {
    cursors: [null, { month: "2026-07", offset: 25 }, { month: "2024-09", offset: 0 }],
    pageIndex: 2,
    pageSize: 25,
    selectedMonth: "2024-09",
  };
  assert.deepEqual(decodeMonthlyReviewView(previous), { ...previous, filterMonth: "" });
  assert.deepEqual(decodeMonthlyReviewView(null), createMonthlyReviewView());
});

test("monthly review restores the selected filter but never caches financial amounts", () => {
  const saved = {
    cursors: [null],
    pageIndex: 0,
    pageSize: 50,
    selectedMonth: "2024-09",
    filterMonth: "2024-09",
  };
  assert.deepEqual(
    decodeMonthlyReviewView({
      ...saved,
      rows: [{ currency: "USD", difference: "999999" }],
      data_kiosk_category_amount: "999999",
    }),
    saved,
  );
});

test("monthly row page preferences reject invalid sizes and non-advancing cursors", () => {
  const initial = createMonthlyReviewView();
  for (const pageSize of [0, -1, 10, 1000, "50", null]) {
    const result = decodeMonthlyReviewView({
      ...initial,
      pageSize,
      pageIndex: 1,
      cursors: [null, { month: "2026-07", offset: 50 }],
    });
    assert.equal(result.pageSize, 25);
    assert.equal(result.pageIndex, 0);
    assert.deepEqual(result.cursors, [null]);
  }
  for (const cursor of [
    { month: "2026-07", offset: -1 },
    { month: "2026-07", offset: 1.5 },
    { month: "2026-07", offset: Number.MAX_SAFE_INTEGER },
    { month: "2026-07,month.lt.1900-01", offset: 25 },
    { month: "2026-13", offset: 25 },
  ]) {
    const result = decodeMonthlyReviewView({ ...initial, cursors: [null, cursor], pageIndex: 1 });
    assert.deepEqual(result.cursors, [null]);
    assert.equal(result.pageIndex, 0);
  }
  const first = { month: "2026-07", offset: 25 };
  for (const cursor of [first, { ...first, offset: 0 }, { month: "2026-08", offset: 0 }]) {
    const result = decodeMonthlyReviewView({
      ...initial,
      cursors: [null, first, cursor],
      pageIndex: 2,
    });
    assert.deepEqual(result.cursors, [null, first]);
    assert.equal(result.pageIndex, 0);
  }
});

test("filtered monthly pages cannot restore a cursor for another month", () => {
  const result = decodeMonthlyReviewView({
    ...createMonthlyReviewView(),
    filterMonth: "2026-06",
    cursors: [null, { month: "2026-07", offset: 25 }],
    pageIndex: 1,
  });
  assert.deepEqual(result.cursors, [null]);
  assert.equal(result.pageIndex, 0);
});

test("invalid saved month filters cannot become query predicates after reload", () => {
  for (const filterMonth of [
    null,
    202609,
    "2026-13",
    "2026-00",
    "2026-9",
    "2026-09-01",
    "2026-09,month.gte.1900-01",
    "2026-09-01T00:00:00Z",
  ]) {
    const restored = decodeMonthlyReviewView({ ...createMonthlyReviewView(), filterMonth });
    assert.equal(restored.filterMonth, "");
  }
});
