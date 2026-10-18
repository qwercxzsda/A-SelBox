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

test("registered component types map to reference groups without changing row identity", () => {
  const cases = [
    ["PRODUCT_SALES", "sales-and-refunds"],
    ["PRODUCT_REFUNDS", "sales-and-refunds"],
    ["NET_PRODUCT_SALES", "sales-and-refunds"],
    ["RESTOCKING", "sales-and-refunds"],
    ["SPONSORED_PRODUCTS_CHARGE", "sponsored-products"],
    ["SPONSORED_PRODUCTS", "sponsored-products"],
    ["FBA_FULFILMENT_FEE", "fba-fulfillment"],
    ["FBA_FULFILLMENT_FEES", "fba-fulfillment"],
    ["FULFILLMENT_FEE_CORRECTIONS", "fba-fulfillment"],
    ["REFERRAL_FEES", "referral"],
    ["REFUNDED_REFERRAL_FEE", "referral"],
    ["REFUNDED_REFERRAL_FEES", "referral"],
    ["FBA_INBOUND_PLACEMENT_SERVICE_FEE", "inbound-placement"],
    ["INBOUND_PLACEMENT_FEES", "inbound-placement"],
    ["FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE", "inbound-transportation"],
    ["INBOUND_TRANSPORTATION_FEES", "inbound-transportation"],
    ["DISPOSAL_FEE", "disposal"],
    ["DISPOSAL_FEES", "disposal"],
    ["REFUND_COMMISSION_FEE", "refund-administration"],
    ["REFUND_COMMISSION", "refund-administration"],
    ["FBA_STORAGE_FEE", "monthly-storage"],
    ["STORAGE_FEES", "monthly-storage"],
    ["SPONSORED_BRANDS_CHARGES", "sponsored-brands"],
    ["SPONSORED_DISPLAY", "sponsored-display"],
    ["ADVERTISING", "advertising"],
    ["DIGITAL_SERVICES_FEE_SOA", "digital-services"],
    ["DIGITAL_SERVICES_FEES", "digital-services"],
    ["REMOVAL_FEE", "removal"],
    ["REMOVAL_FEES", "removal"],
    ["FBA_AGED_INVENTORY_SURCHARGE", "long-term-storage"],
    ["AGED_STORAGE_FEES", "long-term-storage"],
    ["LABELING_FEE", "labeling"],
    ["COUPON_PERFORMANCE_FEE", "promotions"],
    ["DEAL_FEES", "promotions"],
    ["PROMOTIONAL_REBATES", "promotions"],
    ["SHIPPING_TAX", "taxes"],
    ["PRODUCT_TAX", "taxes"],
    ["TAX_WITHHELD", "taxes"],
    ["FBA_INVENTORY_REIMBURSEMENT", "reimbursements"],
    ["INVENTORY_REIMBURSEMENT_REVERSALS", "reimbursements"],
    ["LIQUIDATION_PROCESSING_FEE", "liquidations"],
    ["LIQUIDATION_PROCEEDS", "liquidations"],
    ...[
      "COST_OF_GOODS_SOLD",
      "SHIPPING_TO_AMAZON_COST",
      "MFN_FULFILLMENT_COST",
      "MFN_STORAGE_COST",
      "MISCELLANEOUS_COST",
    ].map((type) => [type, "off-amazon-costs"]),
    ...[
      "PRINCIPAL",
      "REFUND",
      "UNKNOWN_STORAGE_TAX_FEE",
      "UNKNOWN_PRINCIPAL",
      "UNKNOWN_PRICE",
      "UNKNOWN_FEE",
      "OTHER_ADJUSTMENTS",
    ].map((type) => [type, "other"]),
  ];
  for (const [type, id] of cases) {
    const source = Object.freeze(row(type));
    const [group] = groupTransactionTypes([source], "USD");
    assert.equal(group.id, id, type);
    assert.equal(group.types.length, 1, type);
    assert.equal(group.types[0], source, type);
  }
});

test("shipping revenue and explicit chargebacks share a group while shipping tax stays Taxes", () => {
  const types = ["SHIPPING_CREDITS", "SHIPPING_REFUNDS", "SHIPPING_CHARGEBACKS"];
  const groups = groupTransactionTypes(
    [...types.map((type) => row(type)), row("SHIPPING_TAX")],
    "USD",
  );
  assert.deepEqual(
    groups.map((group) => [group.id, group.label]),
    [
      ["shipping-gift-wrap", "Shipping and gift wrap"],
      ["taxes", "Taxes"],
    ],
  );
  assert.deepEqual(
    groups[0].types.map((entry) => entry.type),
    [...types].sort(),
  );
});

test("reference group order and stable child order do not depend on signed or missing amounts", () => {
  const expected = [
    ["PRODUCT_SALES", "sales-and-refunds", "Sales and refunds"],
    ["SPONSORED_PRODUCTS_CHARGE", "sponsored-products", "Sponsored Products charge"],
    ["FBA_FULFILLMENT_FEE", "fba-fulfillment", "FBA fulfillment fees"],
    ["REFERRAL_FEE", "referral", "Referral fee"],
    ["FBA_INBOUND_PLACEMENT_SERVICE_FEE", "inbound-placement", "FBA inbound placement service fee"],
    ["FBA_INBOUND_TRANSPORTATION_FEE", "inbound-transportation", "Inbound transportation charge"],
    ["DISPOSAL_FEE", "disposal", "FBA disposal order fee"],
    ["REFUND_COMMISSION_FEE", "refund-administration", "Refund administration fee"],
    ["MONTHLY_INVENTORY_STORAGE_FEE", "monthly-storage", "Monthly inventory storage fee"],
    ["Z_UNKNOWN", "other", "Other"],
  ];
  const input = expected
    .map(([type], index) => row(type, { companyAmount: index === 2 ? null : String(index - 8) }))
    .reverse();
  input.push(row("NET_PRODUCT_SALES", { companyAmount: "999999999999999999999" }));
  input.push(row("PRODUCT_REFUNDS", { companyAmount: "-1" }));
  input.push(row("A_UNKNOWN", { companyAmount: "-999999999999999999999" }));
  input.forEach(Object.freeze);
  Object.freeze(input);
  const original = [...input];
  const groups = groupTransactionTypes(input, "USD");
  assert.deepEqual(
    groups.map(({ id, label }) => [id, label]),
    expected.map(([, id, label]) => [id, label]),
  );
  assert.deepEqual(
    groups[0].types.map(({ type }) => type),
    ["PRODUCT_SALES", "PRODUCT_REFUNDS", "NET_PRODUCT_SALES"],
  );
  assert.deepEqual(
    groups.at(-1).types.map(({ type }) => type),
    ["A_UNKNOWN", "Z_UNKNOWN"],
  );
  assert.deepEqual(input, original);
  assert.equal(groups.flatMap((group) => group.types).length, input.length);
  assert.equal(new Set(groups.flatMap((group) => group.types)).size, input.length);
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
  assert.equal(groups[0].totals.companyAmount, "0.000000000000000001");
  assert.equal(groups[0].totals.missingFeeCount, 2);
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
