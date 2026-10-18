import assert from "node:assert/strict";
import test from "node:test";
import { planFeeRateChange } from "../src/sku-rate-change.ts";
import { newSkuItem, validateSkuItem } from "../src/sku-configuration-form.ts";

const period = (from, to = null, rate = "5.123456") => ({
  marketplace_name: "Amazon.com",
  valid_from: from,
  valid_to: to,
  fee_rate_percent: rate,
});
const draft = (date, rate = "6.123456", index = 0) => ({
  periodIndex: index,
  effectiveDate: date,
  feeRatePercent: rate,
  previewRequested: true,
});

test("rate changes preserve exact rates and continuous half-open coverage without mutating input", () => {
  const periods = Object.freeze([Object.freeze(period("2026-01-01"))]);
  const { plan, errors } = planFeeRateChange(periods, draft("2026-03-17", "0.000000"));
  assert.deepEqual(errors, {});
  assert.deepEqual(plan.periods, [
    period("2026-01-01", "2026-03-17"),
    period("2026-03-17", null, "0.000000"),
  ]);
  assert.deepEqual(periods, [period("2026-01-01")]);
  assert.deepEqual(
    validateSkuItem({
      ...newSkuItem("S1"),
      company_id: "company",
      periods: plan.periods,
      requirements: [
        { marketplace_name: "Amazon.com", valid_from: "2026-01-01", valid_to: "2026-12-31" },
      ],
    }),
    [],
  );
});

test("a bounded interval retains its end and adjacent periods; changing at the start replaces only that interval", () => {
  const periods = [
    period("2026-01-01", "2026-04-01"),
    period("2026-04-01", "2026-07-01"),
    period("2026-07-01"),
  ];
  assert.deepEqual(planFeeRateChange(periods, draft("2026-05-01", "6.123456", 1)).plan.periods, [
    periods[0],
    period("2026-04-01", "2026-05-01"),
    period("2026-05-01", "2026-07-01", "6.123456"),
    periods[2],
  ]);
  assert.deepEqual(planFeeRateChange(periods, draft("2026-04-01", "0", 1)).plan.periods, [
    periods[0],
    period("2026-04-01", "2026-07-01", "0"),
    periods[2],
  ]);
});

test("exclusive end, out-of-range dates and invalid exact rates cannot produce a plan", () => {
  const periods = [period("2026-01-01", "2026-04-01")];
  for (const date of ["2026-04-01", "2025-12-31", "2026-02-30", ""]) {
    const result = planFeeRateChange(periods, draft(date));
    assert.equal(result.plan, null, date);
    assert.ok(result.errors.effectiveDate, date);
  }
  for (const rate of ["", "-1", "100.000001", "6.1234567", "1e2"]) {
    const result = planFeeRateChange(periods, draft("2026-02-01", rate));
    assert.equal(result.plan, null, rate);
    assert.ok(result.errors.feeRatePercent, rate);
  }
  assert.ok(planFeeRateChange(periods, draft("2026-02-01", "5", 3)).errors.period);
  assert.ok(
    planFeeRateChange([period("2026-01-01", "2026-01-01")], draft("2026-01-01")).errors.period,
  );
});
