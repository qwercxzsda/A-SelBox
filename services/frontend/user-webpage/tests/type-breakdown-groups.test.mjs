import assert from "node:assert/strict";
import test from "node:test";
import { groupTransactionTypes, totalTransactionTypes } from "../src/type-breakdown-groups.ts";
import { sumExactDecimals } from "../src/decimal.ts";

function row(type, overrides = {}) {
  return {
    type,
    currency: "USD",
    reportedAmount: "1",
    serviceFee: "0",
    companyAmount: "1",
    rowCount: 1,
    missingFeeCount: 0,
    ...overrides,
  };
}

test("broad amount groups preserve exact rows and stable child order without an intermediate family layer", () => {
  const input = [
    row("INBOUND_PLACEMENT_FEES"),
    row("FBA_INBOUND_CONVENIENCE_FEE"),
    row("FBA_INBOUND_PLACEMENT_SERVICE_FEE"),
    row("ADVERTISING"),
    row("SPONSORED_PRODUCTS_CHARGE"),
    row("COUPON_FEES"),
    row("DEAL_FEES"),
    row("PRODUCT_REFUNDS"),
    row("NET_PRODUCT_SALES"),
    row("PRODUCT_SALES"),
    row("RESTOCKING"),
    row("UNKNOWN_A"),
    row("UNKNOWN_B"),
    row("STORAGE_FEES"),
    row("REFERRAL_FEES"),
    row("PRODUCT_TAX"),
    row("COST_OF_GOODS_SOLD"),
  ];
  input.forEach(Object.freeze);
  Object.freeze(input);
  const groups = groupTransactionTypes(input, "USD");
  assert.deepEqual(groups, groupTransactionTypes([...input].reverse(), "USD"));
  assert.deepEqual(
    groups.map(({ id, label }) => [id, label]),
    [
      ["sales", "Sales & refunds"],
      ["selling", "Selling fees"],
      ["fulfillment", "Fulfillment & shipping"],
      ["inventory", "Storage & inventory"],
      ["advertising", "Advertising & promotions"],
      ["taxes", "Taxes"],
      ["other", "Other fees & adjustments"],
      ["seller-costs", "Seller-provided costs"],
    ],
  );
  const types = (id) => groups.find((group) => group.id === id).types.map(({ type }) => type);
  assert.deepEqual(types("fulfillment"), [
    "FBA_INBOUND_CONVENIENCE_FEE",
    "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
    "INBOUND_PLACEMENT_FEES",
  ]);
  assert.deepEqual(types("advertising"), [
    "ADVERTISING",
    "COUPON_FEES",
    "DEAL_FEES",
    "SPONSORED_PRODUCTS_CHARGE",
  ]);
  assert.deepEqual(types("sales"), [
    "PRODUCT_SALES",
    "PRODUCT_REFUNDS",
    "NET_PRODUCT_SALES",
    "RESTOCKING",
  ]);
  assert.deepEqual(types("other"), ["UNKNOWN_A", "UNKNOWN_B"]);
  assert.deepEqual(new Set(groups.flatMap(({ types }) => types)), new Set(input));
  assert.equal(groups.flatMap(({ types }) => types).length, input.length);
});

test("shipping and gift wrapping share Fulfillment while taxes stay in Taxes", () => {
  const groups = groupTransactionTypes(
    [
      row("SHIPPING_CREDITS"),
      row("SHIPPING_REFUNDS"),
      row("SHIPPING_CHARGEBACKS"),
      row("GIFT_WRAP_CREDITS"),
      row("SHIPPING_TAX"),
      row("TAX_RECLASSIFICATION"),
    ],
    "USD",
  );
  assert.deepEqual(
    groups.map(({ id, label }) => [id, label]),
    [
      ["fulfillment", "Fulfillment & shipping"],
      ["taxes", "Taxes"],
    ],
  );
});

test("exact subtotals equal the overall total while preserving null and missing-fee evidence", () => {
  const rows = [
    row("PRODUCT_SALES", {
      reportedAmount: "9007199254740993.000000000000000001",
      companyAmount: "9007199254740993.000000000000000001",
    }),
    row("PRODUCT_REFUNDS", {
      reportedAmount: "-9007199254740993",
      companyAmount: "-9007199254740993",
    }),
    row("NET_PRODUCT_SALES", {
      reportedAmount: "3.1",
      serviceFee: null,
      companyAmount: null,
      rowCount: 2,
      missingFeeCount: 2,
    }),
    row("REFERRAL_FEE", {
      reportedAmount: "-0.000000000000000002",
      companyAmount: "-0.000000000000000002",
    }),
    row("UNKNOWN", {
      reportedAmount: null,
      serviceFee: null,
      companyAmount: null,
      missingFeeCount: 1,
    }),
    row("PRODUCT_SALES", { currency: "EUR", reportedAmount: "999", companyAmount: "999" }),
  ];
  const groups = groupTransactionTypes(rows, "USD");
  const total = totalTransactionTypes(rows, "USD");
  assert.deepEqual(total, {
    currency: "USD",
    reportedAmount: "3.099999999999999999",
    serviceFee: "0",
    companyAmount: "-0.000000000000000001",
    rowCount: 6,
    missingFeeCount: 3,
  });
  assert.equal(
    groups.find(({ id }) => id === "sales").totals.companyAmount,
    "0.000000000000000001",
  );
  assert.equal(groups.find(({ id }) => id === "sales").totals.missingFeeCount, 2);
  assert.equal(groups.at(-1).totals.companyAmount, null);
  for (const field of ["reportedAmount", "serviceFee", "companyAmount"])
    assert.equal(sumExactDecimals(groups.map((group) => group.totals[field])), total[field]);
  for (const field of ["rowCount", "missingFeeCount"])
    assert.equal(
      groups.reduce((sum, group) => sum + group.totals[field], 0),
      total[field],
    );
  assert.ok(groups.flatMap((group) => group.types).every((entry) => entry.currency === "USD"));
});

test("an empty currency selection has no groups and no invented monetary zero", () => {
  const rows = [row("PRODUCT_SALES", { currency: "EUR" })];
  assert.deepEqual(groupTransactionTypes(rows, "USD"), []);
  assert.deepEqual(totalTransactionTypes(rows, "USD"), {
    currency: "USD",
    reportedAmount: null,
    serviceFee: null,
    companyAmount: null,
    rowCount: 0,
    missingFeeCount: 0,
  });
});
