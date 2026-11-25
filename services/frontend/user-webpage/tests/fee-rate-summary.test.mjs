import assert from "node:assert/strict";
import test from "node:test";
import { currentFeePeriods, feeRateLabel, utcToday } from "../src/fee-rate-summary.ts";

const period = (marketplace_name, valid_from, valid_to, fee_rate_percent = "5") => ({
  marketplace_name,
  valid_from,
  valid_to,
  fee_rate_percent,
});

test("current fee periods start inclusively, end exclusively and ignore unfinished dates", () => {
  const periods = [
    period("Amazon.com", "2026-01-01", "2026-11-25"),
    period("Amazon.com", "2026-11-25", null, "6"),
    period("Amazon.de", "2026-11-26", null),
    period("Amazon.fr", "", null),
    period("Amazon.it", "2026-01-01", ""),
  ];
  assert.deepEqual(
    currentFeePeriods(periods, "2026-11-25").map(({ marketplace_name, fee_rate_percent }) => [
      marketplace_name,
      fee_rate_percent,
    ]),
    [
      ["Amazon.com", "6"],
      ["Amazon.it", "5"],
    ],
  );
  assert.deepEqual(currentFeePeriods(periods, "2025-12-31"), []);
});

test("today is the UTC calendar day", () => {
  assert.equal(utcToday(Date.parse("2026-11-25T23:59:59-05:00")), "2026-11-26");
  assert.equal(utcToday(Date.parse("2026-11-25T00:00:00Z")), "2026-11-25");
});

test("fee rates keep their exact digits; unfinished draft rates show as typed", () => {
  assert.equal(feeRateLabel("5.123456"), "5.123456%");
  assert.equal(feeRateLabel("0"), "0%");
  assert.equal(feeRateLabel("100.000001"), "100.000001");
  assert.equal(feeRateLabel(""), "Not set");
});
