import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFinancialReviewFamilies } from "../src/financial-review-families.ts";
import { groupTransactionTypes, totalTransactionTypes } from "../src/type-breakdown-groups.ts";
import {
  resolveTypeFamily,
  selectTypeFamilies,
  typeFamilyTypeSelections,
} from "../src/transaction-type-family-catalog.ts";
import { sumExactDecimals } from "../src/decimal.ts";
import { sourceCodeLabel } from "../src/categories.ts";
import { resolveTransactionSearch } from "../src/transaction-search.ts";

const registry = JSON.parse(
  readFileSync(new URL("../src/generated/transaction-types.json", import.meta.url), "utf8"),
);

// These are the source aggregate shapes consumed by the UI, after the Python
// parsers retain Finances signs and invert Data Kiosk fee/advertising charges.
// Look up authority in the generated source registry instead of inventing it here.
function sourceRow(source, component_type, amount, rowCount = 1) {
  const definition = registry.find(
    (entry) => entry.source === source && entry.type === component_type,
  );
  assert.ok(definition, `Unregistered fixture type: ${source}/${component_type}`);
  return {
    source,
    component_type,
    amount,
    row_count: String(rowCount),
    category: definition.category,
    month: "2026-08-01",
    marketplace_name: "Amazon.com",
    currency: "USD",
  };
}

function byFamily(rows) {
  return new Map(buildFinancialReviewFamilies(rows).map((row) => [row.family_id, row]));
}

function transactionTotal(row) {
  return {
    type: row.component_type,
    currency: row.currency,
    reportedAmount: row.amount,
    serviceFee: "0",
    companyAmount: row.amount,
    rowCount: Number(row.row_count),
    missingFeeCount: 0,
  };
}

function assertConserved(rows, families) {
  for (const [source, amountField, countField] of [
    ["FINANCES", "finances_amount", "finances_row_count"],
    ["DATA_KIOSK", "data_kiosk_amount", "data_kiosk_row_count"],
  ]) {
    const sourceRows = rows.filter((row) => row.source === source);
    assert.equal(
      sumExactDecimals([...families.values()].map((row) => row[amountField])) ?? "0",
      sumExactDecimals(sourceRows.map((row) => row.amount)) ?? "0",
    );
    assert.equal(
      [...families.values()].reduce((count, row) => count + BigInt(row[countField]), 0n),
      sourceRows.reduce((count, row) => count + BigInt(row.row_count), 0n),
    );
  }
  const finances =
    sumExactDecimals(rows.filter((row) => row.source === "FINANCES").map((row) => row.amount)) ??
    "0";
  const kiosk =
    sumExactDecimals(rows.filter((row) => row.source === "DATA_KIOSK").map((row) => row.amount)) ??
    "0";
  assert.equal(
    sumExactDecimals([...families.values()].map((row) => row.source_gap)),
    sumExactDecimals([finances, kiosk.startsWith("-") ? kiosk.slice(1) : `-${kiosk}`]),
  );
}

test("comparison eligibility follows defined counterparts, not observed record counts or equal amounts", () => {
  const rows = [
    sourceRow("FINANCES", "SUBSCRIPTION_FEES", "-5"),
    sourceRow("FINANCES", "EPR_FEES", "-5"),
    sourceRow("FINANCES", "PRODUCT_SALES", "873"),
    sourceRow("DATA_KIOSK", "NET_PRODUCT_SALES", "873"),
    sourceRow("FINANCES", "PRODUCT_TAX", "87"),
    sourceRow("FINANCES", "POINTS", "-10"),
  ];
  const families = byFamily(rows);
  const subscription = families.get("subscription");
  assert.equal(subscription.comparison_kind, "paired");
  assert.equal(subscription.data_kiosk_expected, "true");
  assert.equal(subscription.data_kiosk_amount, "0");
  assert.equal(subscription.difference, "-5");
  const epr = families.get("epr-compliance");
  assert.equal(epr.comparison_kind, "unpaired");
  assert.equal(epr.data_kiosk_expected, "false");
  assert.equal(epr.data_kiosk_amount, null);
  assert.equal(epr.data_kiosk_row_count, "0");
  assert.equal(epr.difference, null);
  assert.equal(epr.source_gap, "-5");
  const sales = families.get("net-product-sales");
  assert.equal(sales.comparison_kind, "different-basis");
  assert.equal(sales.difference, null);
  assert.equal(sales.source_gap, "0");
  assert.match(sales.comparison_basis, /refund-request time/);
  assert.match(sales.comparison_basis, /shipping/i);
  assert.equal(families.get("taxes").source_gap, "87");
  assert.equal(families.get("promotions").source_gap, "-10");
  assertConserved(rows, families);
});

test("one transport comparison includes shipment and program charges without hiding missing allocations", () => {
  const rows = [
    sourceRow("FINANCES", "INBOUND_TRANSPORTATION_FEES", "-152.4004"),
    sourceRow("FINANCES", "INBOUND_TRANSPORTATION_PROGRAM_FEES", "-32.0067"),
    sourceRow("DATA_KIOSK", "FBA_INBOUND_TRANSPORTATION_FEE", "0"),
    sourceRow("DATA_KIOSK", "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE", "0"),
  ];
  const families = byFamily(rows);
  assert.equal(families.size, 1);
  assert.equal(families.get("inbound-transportation").difference, "-184.4071");
  assert.equal(families.get("inbound-transportation").comparison_kind, "paired");
  assert.deepEqual(typeFamilyTypeSelections(["inbound-transportation"]), {
    financesTypes: ["INBOUND_TRANSPORTATION_FEES", "INBOUND_TRANSPORTATION_PROGRAM_FEES"],
    dataKioskTypes: ["FBA_INBOUND_TRANSPORTATION_FEE", "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE"],
  });
  assertConserved(rows, families);
});

test("one global taxonomy retains unresolved shipping refunds without market-specific amount adjustments", () => {
  const refunds = [
    sourceRow("FINANCES", "PRODUCT_REFUNDS", "-1746"),
    sourceRow("FINANCES", "SHIPPING_REFUNDS", "-77"),
    sourceRow("DATA_KIOSK", "NET_PRODUCT_SALES", "-1823"),
  ];
  // A retained Japan cohort matches principal plus shipping. That observed overlap
  // does not establish the same inclusion for every refund or another marketplace.
  for (const [marketplace_name, currency] of [
    ["Amazon.co.jp", "JPY"],
    ["Amazon.com", "USD"],
    ["Amazon.co.uk", "GBP"],
    ["Amazon.se", "SEK"],
  ]) {
    const rows = refunds.map((row) => ({ ...row, marketplace_name, currency }));
    const original = structuredClone(rows);
    const families = byFamily(rows);
    const sales = families.get("net-product-sales");
    const shipping = families.get("shipping");
    assert.equal(sales.finances_amount, "-1746");
    assert.equal(sales.data_kiosk_amount, "-1823");
    assert.equal(sales.source_gap, "77");
    assert.equal(sales.comparison_kind, "different-basis");
    assert.equal(sales.difference, null);
    assert.equal(shipping.finances_amount, "-77");
    assert.equal(shipping.data_kiosk_amount, null);
    assert.equal(shipping.comparison_kind, "unpaired");
    assert.equal(shipping.difference, null);
    assert.equal(sumExactDecimals([...families.values()].map((row) => row.source_gap)), "0");
    assertConserved(rows, families);
    assert.deepEqual(rows, original);
  }
  assert.ok(typeFamilyTypeSelections(["shipping"]).financesTypes.includes("SHIPPING_REFUNDS"));
  assert.ok(
    !typeFamilyTypeSelections(["net-product-sales"]).financesTypes.includes("SHIPPING_REFUNDS"),
  );
});

test("Financial review keeps unrelated account fees and credits in separate detailed families", () => {
  const rows = [
    sourceRow("FINANCES", "EPR_FEES", "-10.000000001"),
    sourceRow("FINANCES", "VINE_FEES", "10.000000001"),
    sourceRow("FINANCES", "INBOUND_DEFECT_FEES", "-7"),
    sourceRow("FINANCES", "MCF_CREDITS", "7"),
    sourceRow("FINANCES", "OTHER_ADJUSTMENTS", "-4"),
  ];
  const families = byFamily(rows);
  assert.equal(families.size, rows.length);
  for (const [id, type, amount] of [
    ["epr-compliance", "EPR_FEES", "-10.000000001"],
    ["vine-enrollment", "VINE_FEES", "10.000000001"],
    ["inbound-defects", "INBOUND_DEFECT_FEES", "-7"],
    ["supply-chain-credits", "MCF_CREDITS", "7"],
    ["account-adjustments", "OTHER_ADJUSTMENTS", "-4"],
  ]) {
    assert.equal(families.get(id).finances_amount, amount);
    assert.deepEqual(typeFamilyTypeSelections([id]), {
      financesTypes: [type],
      dataKioskTypes: [],
    });
  }
  assertConserved(rows, families);
});

test("zero-value activity stays visible without inflating product-sales record counts", () => {
  const rows = [
    sourceRow("FINANCES", "PRODUCT_SALES", "100.123456789", 5),
    sourceRow("FINANCES", "PRODUCT_REFUNDS", "-20.000000001", 2),
    // Zero shipment/refund records have no product-principal monetary breakdown.
    sourceRow("FINANCES", "ZERO_ACTIVITY", "0", 3),
    sourceRow("DATA_KIOSK", "NET_PRODUCT_SALES", "80.123456788", 7),
  ];
  const families = byFamily(rows);
  assert.equal(families.size, 2);
  const sales = families.get("net-product-sales");
  assert.equal(sales.finances_amount, "80.123456788");
  assert.equal(sales.difference, null);
  assert.equal(sales.source_gap, "0");
  assert.equal(sales.comparison_kind, "different-basis");
  assert.equal(sales.finances_row_count, "7");
  assert.equal(families.get("zero-value-activity").finances_amount, "0");
  assert.equal(families.get("zero-value-activity").finances_row_count, "3");
  assert.ok(
    !typeFamilyTypeSelections(["net-product-sales"]).financesTypes.includes("ZERO_ACTIVITY"),
  );
  assertConserved(rows, families);
});

test("referral refunds and administration net together while other economic activities remain separate", () => {
  const rows = [
    sourceRow("FINANCES", "REFERRAL_FEES", "-15"),
    sourceRow("FINANCES", "REFUNDED_REFERRAL_FEES", "3"),
    sourceRow("FINANCES", "REFUND_COMMISSION", "-0.6"),
    sourceRow("DATA_KIOSK", "REFERRAL_FEE", "-15"),
    sourceRow("DATA_KIOSK", "REFUNDED_REFERRAL_FEE", "3"),
    sourceRow("DATA_KIOSK", "REFUND_COMMISSION_FEE", "-0.6"),
    sourceRow("FINANCES", "FBA_FULFILLMENT_FEES", "-40.000000009"),
    sourceRow("FINANCES", "FULFILLMENT_FEE_CORRECTIONS", "5"),
    sourceRow("FINANCES", "FULFILLMENT_FEE_REVERSALS", "1.000000001"),
    sourceRow("DATA_KIOSK", "FBA_FULFILMENT_FEE", "-34.000000008"),
    sourceRow("FINANCES", "INVENTORY_REIMBURSEMENTS", "20"),
    sourceRow("FINANCES", "INVENTORY_REIMBURSEMENT_REVERSALS", "-20"),
  ];
  const original = structuredClone(rows);
  const families = byFamily(rows);
  assert.equal(families.size, 3);
  for (const [id, amount] of [
    ["referral", "-12.6"],
    ["fba-fulfillment", "-34.000000008"],
  ]) {
    assert.equal(families.get(id).finances_amount, amount);
    assert.equal(families.get(id).data_kiosk_amount, amount);
    assert.equal(families.get(id).difference, "0");
  }
  assert.equal(families.get("inventory-reimbursements").finances_amount, "0");
  assert.equal(families.get("inventory-reimbursements").finances_row_count, "2");

  const typeTotals = rows.map(transactionTotal);
  const breakdown = groupTransactionTypes(typeTotals, "USD");
  const parentAmounts = new Map();
  for (const definition of selectTypeFamilies([...families.keys()])) {
    const review = families.get(definition.id);
    const amounts = parentAmounts.get(definition.groupId) ?? [];
    amounts.push(review.finances_amount, review.data_kiosk_amount);
    parentAmounts.set(definition.groupId, amounts);
  }
  assert.deepEqual(new Set(breakdown.map(({ id }) => id)), new Set(parentAmounts.keys()));
  for (const group of breakdown) {
    assert.equal(group.totals.reportedAmount, sumExactDecimals(parentAmounts.get(group.id)));
  }
  assert.equal(
    sumExactDecimals(breakdown.map((group) => group.totals.reportedAmount)),
    totalTransactionTypes(typeTotals, "USD").reportedAmount,
  );
  assertConserved(rows, families);
  assert.deepEqual(rows, original);
});

test("one advertising browsing group retains separate source discrepancies in Financial review", () => {
  const rows = [
    sourceRow("FINANCES", "ADVERTISING", "-100"),
    sourceRow("DATA_KIOSK", "SPONSORED_PRODUCT_FEE", "-90"),
    sourceRow("FINANCES", "COUPON_FEES", "-20"),
    sourceRow("DATA_KIOSK", "COUPON_PARTICIPATION_FEE", "-30"),
  ];
  const families = byFamily(rows);
  assert.equal(families.size, 2);
  assert.equal(families.get("sponsored-products").difference, "-10");
  assert.equal(families.get("coupons").difference, "10");
  const authoritativeRows = rows.filter(({ source }) => source === "DATA_KIOSK");
  const [group, ...otherGroups] = groupTransactionTypes(
    authoritativeRows.map(transactionTotal),
    "USD",
  );
  assert.deepEqual(otherGroups, []);
  assert.equal(group.id, "advertising");
  assert.equal(group.label, "Advertising & promotions");
  assert.equal(group.totals.reportedAmount, "-120");
  assert.equal(group.totals.rowCount, 2);
  assert.deepEqual(
    new Set(group.types.map(({ type }) => type)),
    new Set(authoritativeRows.map(({ component_type }) => component_type)),
  );
  assertConserved(rows, families);
});

test("unverified placement-service correspondence cannot erase an inbound-convenience discrepancy", () => {
  // FbaInboundConvenienceFee is observed in both retained source namespaces.
  // Placement service is a separately admitted Data Kiosk key, not an evidenced alias.
  const rows = [
    sourceRow("FINANCES", "INBOUND_PLACEMENT_FEES", "-100"),
    sourceRow("DATA_KIOSK", "FBA_INBOUND_CONVENIENCE_FEE", "-90"),
    sourceRow("DATA_KIOSK", "FBA_INBOUND_PLACEMENT_SERVICE_FEE", "-10"),
  ];
  const families = byFamily(rows);
  assert.equal(families.size, 2);
  assert.equal(families.get("inbound-convenience").difference, "-10");
  assert.equal(families.get("inbound-placement").difference, null);
  assert.equal(families.get("inbound-placement").source_gap, "10");
  assert.equal(families.get("inbound-placement").finances_amount, null);
  assert.deepEqual(typeFamilyTypeSelections(["inbound-convenience"]), {
    financesTypes: ["INBOUND_PLACEMENT_FEES"],
    dataKioskTypes: ["FBA_INBOUND_CONVENIENCE_FEE"],
  });
  assert.deepEqual(typeFamilyTypeSelections(["inbound-placement"]), {
    financesTypes: [],
    dataKioskTypes: ["FBA_INBOUND_PLACEMENT_SERVICE_FEE"],
  });
  assertConserved(rows, families);
});

test("native convenience labels preserve the exact identity used by current and saved records", () => {
  const type = "INBOUND_PLACEMENT_FEES";
  assert.equal(sourceCodeLabel(type), "Inbound convenience fees");
  assert.equal(resolveTypeFamily("FINANCES", type).id, "inbound-convenience");
  assert.deepEqual(
    resolveTransactionSearch("finances", "administrator", [], "inbound convenience").types,
    [type],
  );
  assert.deepEqual(typeFamilyTypeSelections(["inbound-convenience"]).financesTypes, [type]);
});

test("seller-provided per-unit costs cannot be mistaken for additive Amazon fee families", () => {
  const costTypes = registry.filter(
    (entry) => entry.source === "DATA_KIOSK" && entry.category === "ANALYSIS_ONLY",
  );
  assert.equal(costTypes.length, 5);
  for (const { type } of costTypes) {
    const family = resolveTypeFamily("DATA_KIOSK", type);
    assert.match(family.label, /per unit/i, type);
    assert.match(family.description, /seller.provided/i, type);
    assert.match(family.description, /per.unit/i, type);
    assert.match(family.description, /analysis.only/i, type);
    assert.deepEqual(family.financesTypes, []);
    assert.deepEqual(family.dataKioskTypes, [type]);
  }
  const fulfillment = resolveTypeFamily("DATA_KIOSK", "MFN_FULFILLMENT_COST");
  for (const purpose of [/labo[u]?r/i, /pack/i, /customer service/i])
    assert.match(fulfillment.description, purpose);
  assert.match(resolveTypeFamily("DATA_KIOSK", "MFN_STORAGE_COST").description, /month/i);
  assert.notEqual(
    resolveTypeFamily("DATA_KIOSK", "SHIPPING_TO_AMAZON_COST").id,
    resolveTypeFamily("DATA_KIOSK", "FBA_INBOUND_TRANSPORTATION_FEE").id,
  );
  assert.notEqual(
    resolveTypeFamily("DATA_KIOSK", "MFN_STORAGE_COST").id,
    resolveTypeFamily("DATA_KIOSK", "FBA_STORAGE_FEE").id,
  );
});
