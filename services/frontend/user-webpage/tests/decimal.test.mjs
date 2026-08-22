import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExactDecimal,
  formatExactMoney,
  formatExactQuantity,
  isNonZeroDecimal,
} from "../src/decimal.ts";

test("formats arbitrary-precision money without rounding", () => {
  assert.equal(
    formatExactMoney("12345678901234567890.12345678901234567890100", "usd"),
    "12,345,678,901,234,567,890.123456789012345678901 USD",
  );
  assert.equal(formatExactMoney("-0.000000000000000001", "USD"), "-0.000000000000000001 USD");
});

test("expands decimal exponents exactly and normalizes signed zero", () => {
  assert.equal(formatExactDecimal("1.23e-3"), "0.00123");
  assert.equal(formatExactQuantity(".5e+2"), "50");
  assert.equal(formatExactDecimal("-0.000e99"), "0");
});

test("distinguishes missing, invalid, zero, and nonzero values", () => {
  assert.equal(formatExactDecimal(null), "—");
  assert.equal(formatExactDecimal("NaN"), "—");
  assert.equal(formatExactMoney("1", "US"), "—");
  assert.equal(isNonZeroDecimal("0.000"), false);
  assert.equal(isNonZeroDecimal("-0.0001"), true);
  assert.equal(isNonZeroDecimal(null), false);
});

test("preserves PostgreSQL's full unconstrained numeric digit envelope", () => {
  const databaseMaximum = `${"9".repeat(131_072)}.${"1".repeat(16_383)}`;
  assert.equal(formatExactDecimal(databaseMaximum).replaceAll(",", ""), databaseMaximum);
});
