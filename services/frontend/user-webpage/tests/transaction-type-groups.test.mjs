import assert from "node:assert/strict";
import test from "node:test";
import { filterOptions, transactionTypeValues } from "../src/filter-options.ts";
import {
  transactionTypeGroups,
  transactionTypeSelectionLabels,
} from "../src/transaction-type-groups.ts";

const catalog = filterOptions("component_type", transactionTypeValues("live", "operator"));
const groups = transactionTypeGroups(catalog);

function groupFor(value) {
  return groups.find(({ options }) => options.some((option) => option.value === value))?.id;
}

test("the real type catalog is a complete, stable partition preserving exact options", () => {
  const frozen = Object.freeze(catalog.map((option) => Object.freeze({ ...option })));
  const forward = transactionTypeGroups(frozen);
  const backward = transactionTypeGroups([...frozen].reverse());
  assert.deepEqual(forward, backward);
  assert.deepEqual(
    forward.map(({ id, label }) => [id, label]),
    [
      ["sales", "Sales & refunds"],
      ["selling", "Selling fees"],
      ["fulfillment", "Fulfillment & shipping"],
      ["inventory", "Storage & inventory"],
      ["advertising", "Advertising & promotions"],
      ["taxes", "Taxes"],
      ["other", "Other fees & adjustments"],
      ["seller-costs", "Seller-provided costs"],
      ["reconciliation", "Reconciliation"],
    ],
  );
  const members = forward.flatMap(({ options }) => options);
  assert.equal(members.length, frozen.length);
  assert.deepEqual(new Set(members), new Set(frozen));
  assert.deepEqual(
    new Set(members.map(({ value }) => value)),
    new Set(frozen.map(({ value }) => value)),
  );
});

test("both sources' related types are easy to select together without merging their keys", () => {
  const cases = {
    sales: ["PRODUCT_SALES", "PRODUCT_REFUNDS", "NET_PRODUCT_SALES"],
    selling: ["REFERRAL_FEE", "Order/ItemFees/Commission", "REFUNDED_REFERRAL_FEE"],
    fulfillment: [
      "FBA_FULFILMENT_FEE",
      "FBA_FULFILLMENT_FEE",
      "Order/ItemFees/FBAPerUnitFulfillmentFee",
      "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
      "FBAFees/FBA Inbound Placement Service Fee/Base fee",
      "LABELING_FEE",
      "Order/ItemPrice/Shipping",
      "Refund/ItemFees/ShippingChargeback",
    ],
    inventory: [
      "FBA_STORAGE_FEE",
      "FBAFees/FBA Inventory Storage Fee/Base fee",
      "FBAFees/FBA Inventory Storage Fee/Tax on fee",
      "FBAFees/FBA Long Term Storage Fee/Tax on fee",
      "FBAFees/FBA Removal Order: Disposal Fee/Tax on fee",
      "FBA_INVENTORY_REIMBURSEMENT",
      "Liquidations/ItemPrice/Principal",
    ],
    advertising: [
      "SPONSORED_PRODUCT_FEE",
      "ServiceFee/Cost of Advertising/TransactionTotalAmount",
      "COUPON_PARTICIPATION_FEE",
      "AmazonFees/Coupon Participation Fee/Base fee",
      "Order/Promotion/Principal",
    ],
    taxes: [
      "Order/ItemWithheldTax/MarketplaceFacilitatorVAT-Principal",
      "Refund/ItemPrice/ShippingTax",
      "Order/Promotion/TaxDiscount",
    ],
    other: [
      "SUBSCRIPTION_FEE",
      "other-transaction/other-transaction/Subscription Fee",
      "Debt Adjustment/Debt Adjustment/Cross-Account Debt Adjustment against BE, ES",
      "AmazonFees/Eco-contribution for EPR Pay on Behalf - GB - Packaging - (Period 01.07.2024 - 31.12.2024)/Base fee",
    ],
    "seller-costs": ["MFN_STORAGE_COST", "MFN_FULFILLMENT_COST", "COST_OF_GOODS_SOLD"],
    reconciliation: ["SETTLEMENT_KIOSK_DIFFERENCE"],
  };
  for (const [id, values] of Object.entries(cases))
    for (const value of values) assert.equal(groupFor(value), id, value);
});

test("role and source scopes are preserved and unfamiliar selected keys stay in Other", () => {
  for (const role of ["company_member", "operator"])
    for (const dataset of ["live", "settlement", "data_kiosk"]) {
      const values = transactionTypeValues(dataset, role);
      const options = filterOptions("component_type", values, ["UNKNOWN_STORAGE_TAX_FEE"]);
      const scoped = transactionTypeGroups(options);
      assert.deepEqual(
        new Set(scoped.flatMap(({ options }) => options.map(({ value }) => value))),
        new Set([...values, "UNKNOWN_STORAGE_TAX_FEE"]),
      );
      assert.ok(
        scoped
          .find(({ id }) => id === "other")
          .options.some(({ value }) => value === "UNKNOWN_STORAGE_TAX_FEE"),
      );
    }
  assert.deepEqual(transactionTypeGroups([]), []);
});

test("complete groups have short selection labels while partial groups keep original labels", () => {
  const sales = groups.find(({ id }) => id === "sales");
  const selling = groups.find(({ id }) => id === "selling");
  const selected = [...sales.options.map(({ value }) => value), selling.options[0].value];
  assert.deepEqual(transactionTypeSelectionLabels(catalog, selected), [
    "Sales & refunds",
    selling.options[0].label,
  ]);
  assert.deepEqual(transactionTypeSelectionLabels(catalog, ["PRODUCT_SALES"]), ["Product sales"]);
  assert.deepEqual(transactionTypeSelectionLabels(catalog, []), []);
  assert.deepEqual(
    transactionTypeSelectionLabels(
      catalog,
      catalog.map(({ value }) => value),
    ),
    groups.map(({ label }) => label),
  );
});

test("unknown selections remain explicit, including alongside a fully selected Other group", () => {
  const options = [...catalog, { value: "UNKNOWN_TYPE", label: "Saved unfamiliar type" }];
  const other = groups.find(({ id }) => id === "other");
  const selected = [
    ...other.options.map(({ value }) => value),
    "UNKNOWN_TYPE",
    "ABSENT_FROM_OPTIONS",
    "UNKNOWN_TYPE",
  ];
  assert.deepEqual(transactionTypeSelectionLabels(options, selected), [
    "Other fees & adjustments",
    "Saved unfamiliar type",
    "ABSENT_FROM_OPTIONS",
  ]);
  assert.deepEqual(transactionTypeSelectionLabels([], ["UNKNOWN_TYPE"]), ["UNKNOWN_TYPE"]);
});
