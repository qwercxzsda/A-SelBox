import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount, formatExactDecimal, formatMoney, sumExactDecimals } from "../src/decimal.ts";

test("displays every monetary amount with two decimal places, including zero and yen", () => {
  assert.equal(formatAmount("0"), "0.00");
  assert.equal(formatAmount("12"), "12.00");
  assert.equal(formatAmount("12.3"), "12.30");
  assert.equal(formatAmount("1234.5600"), "1,234.56");
  assert.equal(formatMoney("0", "USD"), "0.00 USD");
  assert.equal(formatMoney("1234", "JPY"), "1,234.00 JPY");
  assert.equal(formatMoney("12.345", "JPY"), "12.35 JPY");
  assert.equal(formatMoney("12.3", " usd "), "12.30 USD");
});

test("rounds decimal ties away from zero without binary floating-point errors", () => {
  for (const [value, expected] of [
    ["1.005", "1.01"],
    ["-1.005", "-1.01"],
    ["2.675", "2.68"],
    ["-2.675", "-2.68"],
    ["1.004999999999999999999999999", "1.00"],
    ["1.005000000000000000000000001", "1.01"],
    ["-1.004999999999999999999999999", "-1.00"],
    ["999.995", "1,000.00"],
    ["-999.995", "-1,000.00"],
  ]) {
    assert.equal(formatAmount(value), expected, value);
  }
});

test("preserves large integer precision and carries rounding across all digits", () => {
  assert.equal(
    formatMoney("12345678901234567890.12345678901234567890100", "USD"),
    "12,345,678,901,234,567,890.12 USD",
  );
  assert.equal(formatAmount("9007199254740993.995"), "9,007,199,254,740,994.00");
  assert.equal(
    formatAmount("999999999999999999999999999999.999"),
    "1,000,000,000,000,000,000,000,000,000,000.00",
  );
});

test("expands scientific notation before rounding monetary amounts", () => {
  assert.equal(formatAmount("1.005e2"), "100.50");
  assert.equal(formatAmount("5e-3"), "0.01");
  assert.equal(formatAmount("-5E-3"), "-0.01");
  assert.equal(formatAmount("4.999e-3"), "0.00");
  assert.equal(formatAmount(".5e+2"), "50.00");
  assert.equal(formatMoney("999995e-3", "EUR"), "1,000.00 EUR");
});

test("normalizes signed and rounded zero without hiding a negative cent", () => {
  assert.equal(formatAmount("-0"), "0.00");
  assert.equal(formatAmount("-0.000e99"), "0.00");
  assert.equal(formatAmount("-0.004999999999999999"), "0.00");
  assert.equal(formatMoney("-0.000000000000000001", "USD"), "0.00 USD");
  assert.equal(formatMoney("-0.005", "USD"), "-0.01 USD");
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

test("rounds totals only after exact aggregation of unrounded amounts", () => {
  const smallCharges = sumExactDecimals(["0.004", "0.004"]);
  assert.equal(smallCharges, "0.008");
  assert.equal(formatMoney(smallCharges, "USD"), "0.01 USD");
  const halfCentCharges = sumExactDecimals(["0.005", "0.005"]);
  assert.equal(halfCentCharges, "0.01");
  assert.equal(formatMoney(halfCentCharges, "USD"), "0.01 USD");
  const difference = sumExactDecimals(["12345678901234567890.005", "-12345678901234567890.004"]);
  assert.equal(difference, "0.001");
  assert.equal(formatAmount(difference), "0.00");
});

test("expands decimal exponents exactly and normalizes signed zero", () => {
  assert.equal(formatExactDecimal("1.23e-3"), "0.00123");
  assert.equal(formatExactDecimal(".5e+2"), "50");
  assert.equal(formatExactDecimal("-0.000e99"), "0");
});

test("distinguishes missing, invalid, zero, and nonzero values", () => {
  assert.equal(formatExactDecimal(null), "—");
  assert.equal(formatExactDecimal("NaN"), "—");
  for (const value of [null, "", "NaN", "Infinity", "1,000", "1.2.3", "1e", "1e999999999"]) {
    assert.equal(formatAmount(value), "—", String(value));
    assert.equal(formatMoney(value, "USD"), "—", String(value));
  }
  assert.equal(formatMoney("1", "US"), "—");
  assert.equal(formatMoney("0.000", null), "0.00");
  assert.equal(formatMoney("-0", null), "0.00");
  assert.equal(formatMoney("1", null), "—");
  assert.equal(formatMoney("0.001", null), "—");
  assert.equal(formatMoney(null, null), "—");
  assert.equal(formatMoney("0", "US"), "—");
  assert.equal(formatExactDecimal("0.000"), "0");
  assert.equal(formatExactDecimal("-0.0001"), "-0.0001");
});

test("preserves PostgreSQL's full unconstrained numeric digit envelope", () => {
  const databaseMaximum = `${"9".repeat(131_072)}.${"1".repeat(16_383)}`;
  assert.equal(formatExactDecimal(databaseMaximum).replaceAll(",", ""), databaseMaximum);
  assert.equal(formatAmount(databaseMaximum).replaceAll(",", ""), `${"9".repeat(131_072)}.11`);
});
