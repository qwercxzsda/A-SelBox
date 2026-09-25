import assert from "node:assert/strict";
import test from "node:test";
import { formatExactDecimal, formatExactMoney, sumExactDecimals } from "../src/decimal.ts";

test("formats arbitrary-precision money without rounding", () => {
  assert.equal(
    formatExactMoney("12345678901234567890.12345678901234567890100", "usd"),
    "12,345,678,901,234,567,890.123456789012345678901 USD",
  );
  assert.equal(formatExactMoney("-0.000000000000000001", "USD"), "-0.000000000000000001 USD");
});

test("sums decimal aggregate buckets exactly while preserving unknown totals", () => {
  assert.equal(sumExactDecimals(["0.1", "0.2"]), "0.3");
  assert.equal(
    sumExactDecimals(["9007199254740993.000000000000000001", "0.000000000000000009"]),
    "9007199254740993.00000000000000001",
  );
  assert.equal(sumExactDecimals(["-5.123456", "5.123456", "-0"]), "0");
  assert.equal(sumExactDecimals(["1e-18", "2E-18", "-.1"]), "-0.099999999999999997");
  assert.equal(sumExactDecimals([null, "0"]), "0");
  assert.equal(sumExactDecimals([null, null]), null);
  assert.equal(sumExactDecimals([]), null);
  assert.throws(() => sumExactDecimals(["NaN"]), /invalid decimal/);
});

test("expands decimal exponents exactly and normalizes signed zero", () => {
  assert.equal(formatExactDecimal("1.23e-3"), "0.00123");
  assert.equal(formatExactDecimal(".5e+2"), "50");
  assert.equal(formatExactDecimal("-0.000e99"), "0");
});

test("distinguishes missing, invalid, zero, and nonzero values", () => {
  assert.equal(formatExactDecimal(null), "—");
  assert.equal(formatExactDecimal("NaN"), "—");
  assert.equal(formatExactMoney("1", "US"), "—");
  assert.equal(formatExactDecimal("0.000"), "0");
  assert.equal(formatExactDecimal("-0.0001"), "-0.0001");
});

test("preserves PostgreSQL's full unconstrained numeric digit envelope", () => {
  const databaseMaximum = `${"9".repeat(131_072)}.${"1".repeat(16_383)}`;
  assert.equal(formatExactDecimal(databaseMaximum).replaceAll(",", ""), databaseMaximum);
});
