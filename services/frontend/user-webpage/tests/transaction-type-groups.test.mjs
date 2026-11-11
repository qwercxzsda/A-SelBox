import assert from "node:assert/strict";
import test from "node:test";
import { filterOptions, transactionTypeValues } from "../src/filter-options.ts";
import {
  searchTransactionTypeGroups,
  transactionTypeGroups,
  transactionTypeSelectionLabels,
  transactionTypeGroupLabel,
} from "../src/transaction-type-groups.ts";

const catalog = filterOptions("component_type", transactionTypeValues("live", "administrator"));
const groups = transactionTypeGroups(catalog);

test("search matches whole group names or precise type words without broadening to siblings", () => {
  assert.deepEqual(searchTransactionTypeGroups(groups, "  "), groups);
  assert.deepEqual(searchTransactionTypeGroups(groups, "INVENTORY storage"), [
    groups.find(({ id }) => id === "inventory"),
  ]);
  const values = (search) =>
    searchTransactionTypeGroups(groups, search).flatMap(({ options }) =>
      options.map(({ value }) => value),
    );
  const storageFees = values("storage fee");
  assert.ok(storageFees.includes("FBA_STORAGE_FEE"));
  assert.ok(!storageFees.includes("DISPOSAL_FEE"));
  assert.deepEqual(values("FBA_STORAGE_FEE"), ["FBA_STORAGE_FEE"]);
  assert.deepEqual(values("inventory disposal"), []);
  assert.deepEqual(values("no such type"), []);
});

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
    ],
  );
  const members = forward.flatMap(({ options }) => options);
  for (const group of forward)
    for (const option of group.options)
      assert.equal(transactionTypeGroupLabel(option.value), group.label);
  assert.equal(members.length, frozen.length);
  assert.deepEqual(new Set(members), new Set(frozen));
  assert.deepEqual(
    new Set(members.map(({ value }) => value)),
    new Set(frozen.map(({ value }) => value)),
  );
});

test("Transactions groups contain only the authoritative types from each source", () => {
  const cases = {
    sales: ["PRODUCT_SALES", "PRODUCT_REFUNDS"],
    selling: ["REFERRAL_FEES", "REFUNDED_REFERRAL_FEES", "REFUND_COMMISSION"],
    fulfillment: [
      "FBA_FULFILLMENT_FEES",
      "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
      "LABELING_FEE",
      "SHIPPING_CREDITS",
      "SHIPPING_CHARGEBACKS",
    ],
    inventory: [
      "FBA_STORAGE_FEE",
      "FBA_AGED_INVENTORY_SURCHARGE",
      "DISPOSAL_FEE",
      "INVENTORY_REIMBURSEMENTS",
      "LIQUIDATION_PROCEEDS",
    ],
    advertising: [
      "SPONSORED_PRODUCT_FEE",
      "COUPON_PARTICIPATION_FEE",
      "RUN_LIGHTNING_DEAL_FEE",
      "PROMOTIONAL_REBATES",
    ],
    taxes: ["TAX_WITHHELD", "SHIPPING_TAX", "PRODUCT_TAX"],
    other: ["SUBSCRIPTION_FEES", "CROSS_ACCOUNT_ADJUSTMENTS", "EPR_FEES"],
  };
  for (const [id, values] of Object.entries(cases))
    for (const value of values) assert.equal(groupFor(value), id, value);
});

test("administrator raw source groups preserve supporting and seller-provided types", () => {
  const raw = transactionTypeGroups(
    filterOptions("component_type", transactionTypeValues("data_kiosk", "administrator")),
  );
  const values = (id) => raw.find((group) => group.id === id).options.map(({ value }) => value);
  assert.ok(values("sales").includes("NET_PRODUCT_SALES"));
  assert.ok(values("seller-costs").includes("COST_OF_GOODS_SOLD"));
  assert.ok(values("selling").includes("REFERRAL_FEE"));
});

test("role and source scopes are preserved and unfamiliar selected keys stay in Other", () => {
  for (const role of ["member", "administrator"])
    for (const dataset of ["live", "finances", "data_kiosk"]) {
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
  assert.equal(transactionTypeGroupLabel("UNKNOWN_STORAGE_TAX_FEE"), "Other fees & adjustments");
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
