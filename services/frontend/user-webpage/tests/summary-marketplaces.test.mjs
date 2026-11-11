import assert from "node:assert/strict";
import test from "node:test";
import marketplaceOptions from "../src/generated/marketplaces.json" with { type: "json" };
import { summaryMarketplaces, sortMarketplaceSummaries } from "../src/summary-marketplaces.ts";

test("default totals include all filter marketplaces without requiring data", () => {
  assert.deepEqual(summaryMarketplaces([]), [...marketplaceOptions].sort());
});

test("explicit selected marketplaces remain exact, ordered, and immutable", () => {
  const selected = Object.freeze(["Amazon.sg", "Amazon.com", "Amazon.sg"]);
  assert.deepEqual(summaryMarketplaces(selected), ["Amazon.com", "Amazon.sg"]);
  assert.deepEqual(selected, ["Amazon.sg", "Amazon.com", "Amazon.sg"]);
});

test("retained explicit marketplace names are not replaced by data from other markets", () => {
  assert.deepEqual(summaryMarketplaces(["Retained marketplace"]), ["Retained marketplace"]);
});

function summary(marketplace, selected, month, day) {
  const totals = (exists) =>
    exists
      ? [
          {
            marketplace,
            currency: "USD",
            reportedAmount: "0",
            serviceFee: "0",
            companyAmount: "0",
            rowCount: 1,
            missingFeeCount: 0,
          },
        ]
      : [];
  return { marketplace, selected: totals(selected), month: totals(month), day: totals(day) };
}

test("marketplaces sort by selected, monthly, then daily presence with inactive markets last", () => {
  const groups = Object.freeze([
    summary("A-empty", false, false, false),
    summary("B-day", false, false, true),
    summary("C-month", false, true, false),
    summary("D-month-day", false, true, true),
    summary("E-selected", true, false, false),
    summary("F-selected-day", true, false, true),
    summary("G-selected-month", true, true, false),
    summary("H-all", true, true, true),
  ]);
  const original = [...groups];
  assert.deepEqual(
    sortMarketplaceSummaries(groups).map((group) => group.marketplace),
    [
      "H-all",
      "G-selected-month",
      "F-selected-day",
      "E-selected",
      "D-month-day",
      "C-month",
      "B-day",
      "A-empty",
    ],
  );
  assert.deepEqual(groups, original);
});

test("activity ties use names regardless of zero, negative, unknown amounts, count, or currency", () => {
  const a = summary("Amazon.ca", true, true, true);
  const b = summary("Amazon.co.jp", true, true, true);
  const c = summary("Amazon.com", true, true, true);
  b.selected[0] = {
    ...b.selected[0],
    currency: "JPY",
    reportedAmount: "-99999999999999",
    serviceFee: null,
    companyAmount: null,
    rowCount: 99,
    missingFeeCount: 99,
  };
  c.selected.push({
    ...c.selected[0],
    currency: "EUR",
    reportedAmount: "99999999999999",
    rowCount: 1_000_000,
  });
  assert.deepEqual(
    sortMarketplaceSummaries([c, b, a]).map((group) => group.marketplace),
    ["Amazon.ca", "Amazon.co.jp", "Amazon.com"],
  );
});

test("empty periods do not invent activity and resolve to alphabetical ties", () => {
  const a = summary("Amazon.ca", false, false, false);
  const b = summary("Amazon.com", false, false, false);
  assert.deepEqual(
    sortMarketplaceSummaries([b, a]).map((group) => group.marketplace),
    ["Amazon.ca", "Amazon.com"],
  );
});
