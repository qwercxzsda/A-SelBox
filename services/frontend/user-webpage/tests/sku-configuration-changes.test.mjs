import assert from "node:assert/strict";
import test from "node:test";
import { feePeriodChanges } from "../src/sku-configuration-changes.ts";

const period = (rate, from = "2026-01-01", to = null, marketplace = "Amazon.com") => ({
  marketplace_name: marketplace,
  valid_from: from,
  valid_to: to,
  fee_rate_percent: rate,
});

test("fee review keeps exact decimal changes and ignores rate formatting or reordered periods", () => {
  const saved = [period("0"), period("6.123456", "2026-01-01", null, "Amazon.co.jp")];
  assert.deepEqual(feePeriodChanges(saved, [saved[1], period("0.000000")]), []);
  assert.deepEqual(
    feePeriodChanges(saved, [period("0"), { ...saved[1], fee_rate_percent: "6.123455" }]),
    [
      {
        kind: "rate",
        period: { ...saved[1], fee_rate_percent: "6.123455" },
        previousRate: "6.123456",
      },
    ],
  );
});

test("fee review identifies removals and exact interval changes without hiding original dates", () => {
  const saved = [period("5", "2026-01-01", "2026-03-01"), period("6", "2026-03-01")];
  const proposed = [period("5", "2026-01-01", "2026-02-01")];
  assert.deepEqual(feePeriodChanges(saved, proposed), [
    { kind: "added", period: proposed[0] },
    { kind: "removed", period: saved[0] },
    { kind: "removed", period: saved[1] },
  ]);
  assert.deepEqual(
    saved.map((row) => row.fee_rate_percent),
    ["5", "6"],
  );
});

test("unfinished and duplicate periods remain distinguishable in review", () => {
  assert.deepEqual(
    feePeriodChanges([period("5"), period("6")], [period("6"), period("5.000000")]),
    [],
  );
  assert.deepEqual(feePeriodChanges([period("bad")], [period("")]), [
    { kind: "rate", period: period(""), previousRate: "bad" },
  ]);
});
