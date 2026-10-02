import assert from "node:assert/strict";
import test from "node:test";
import { formatRecordDate, formatRecordMonth } from "../src/date-display.ts";

test("JSON and CSV timestamps share a compact UTC display", () => {
  for (const value of [
    "2026-10-01T03:04:05.123456Z",
    "2026-10-01 03:04:05.123456+00",
    "2026-10-01T12:04:05+09:00",
    "2026-10-01T12:04:05+0900",
  ]) {
    assert.equal(formatRecordDate(value), "2026-10-01 03:04:05 UTC");
  }
  assert.equal(formatRecordDate("2026-10-01T00:04:05+09:00"), "2026-09-30 15:04:05 UTC");
});

test("calendar dates and unrecognized source values are preserved", () => {
  for (const value of ["2026-10-01", "2026-10-01 12:04:05", "unavailable", ""]) {
    assert.equal(formatRecordDate(value), value);
  }
});

test("report month labels use UTC and preserve unrecognized dates", () => {
  assert.equal(formatRecordMonth("2026-07-01"), "July 2026");
  assert.equal(formatRecordMonth("2026-01"), "January 2026");
  for (const value of ["", "2026-13-01", "unavailable"]) {
    assert.equal(formatRecordMonth(value), value);
  }
});
