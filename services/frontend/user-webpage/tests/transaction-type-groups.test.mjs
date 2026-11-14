import assert from "node:assert/strict";
import test from "node:test";
import { filterOptions, transactionTypeValues } from "../src/filter-options.ts";
import {
  searchTransactionTypeGroups,
  transactionTypeGroups,
  transactionTypeSelectionLabels,
  transactionTypeGroupLabel,
} from "../src/transaction-type-groups.ts";
import { groupTransactionTypes } from "../src/type-breakdown-groups.ts";
import { resolveTypeFamily, transactionTypeGroup } from "../src/transaction-type-family-catalog.ts";
import {
  TRANSACTION_TYPE_GROUPS,
  TRANSACTION_TYPE_FAMILIES,
} from "../src/transaction-type-families.ts";
import taxonomy from "../src/generated/transaction-types.json" with { type: "json" };

const catalog = filterOptions("component_type", transactionTypeValues("live", "administrator"));
const groups = transactionTypeGroups(catalog);

test("every registered type inherits its browsing group from its detailed review family", () => {
  for (const { source, type } of taxonomy) {
    const review = resolveTypeFamily(source, type);
    const [filter] = transactionTypeGroups([{ value: type, label: type }]);
    const [breakdown] = groupTransactionTypes(
      [
        {
          type,
          currency: "USD",
          reportedAmount: "1",
          serviceFee: "0",
          companyAmount: "1",
          rowCount: 1,
          missingFeeCount: 0,
        },
      ],
      "USD",
    );
    const group = TRANSACTION_TYPE_GROUPS.find(({ id }) => id === review.groupId);
    assert.ok(group, `${source}/${type} must have one declared parent group`);
    assert.equal(filter.id, group.id, `${source}/${type}`);
    assert.equal(filter.label, group.label, `${source}/${type}`);
    assert.equal(breakdown.id, group.id, `${source}/${type}`);
    assert.equal(breakdown.label, group.label, `${source}/${type}`);
    assert.equal(transactionTypeGroupLabel(type), group.label, `${source}/${type}`);
  }
});

test("search matches group names or exact type words without broadening to siblings", () => {
  assert.deepEqual(searchTransactionTypeGroups(groups, "  "), groups);
  assert.deepEqual(searchTransactionTypeGroups(groups, "storage inventory"), [
    groups.find(({ id }) => id === "inventory"),
  ]);
  const values = (search) =>
    searchTransactionTypeGroups(groups, search).flatMap(({ options }) =>
      options.map(({ value }) => value),
    );
  assert.ok(values("storage fee").includes("FBA_STORAGE_FEE"));
  assert.ok(!values("storage fee").includes("DISPOSAL_FEE"));
  assert.deepEqual(values("FBA_STORAGE_FEE"), ["FBA_STORAGE_FEE"]);
  assert.deepEqual(values("inventory disposal"), []);
  assert.deepEqual(values("no such type"), []);
});

test("the type catalog is a stable complete partition without changing exact options", () => {
  const frozen = Object.freeze(catalog.map((option) => Object.freeze({ ...option })));
  const forward = transactionTypeGroups(frozen);
  assert.deepEqual(forward, transactionTypeGroups([...frozen].reverse()));
  const members = forward.flatMap(({ options }) => options);
  assert.equal(members.length, frozen.length);
  assert.deepEqual(new Set(members), new Set(frozen));
  assert.deepEqual(
    forward.map(({ id, label }) => ({ id, label })),
    TRANSACTION_TYPE_GROUPS.filter(({ id }) => id !== "seller-costs"),
  );
});

test("the original broad groups and order preserve reviewed type boundaries", () => {
  assert.deepEqual(TRANSACTION_TYPE_GROUPS, [
    { id: "sales", label: "Sales & refunds" },
    { id: "selling", label: "Selling fees" },
    { id: "fulfillment", label: "Fulfillment & shipping" },
    { id: "inventory", label: "Storage & inventory" },
    { id: "advertising", label: "Advertising & promotions" },
    { id: "taxes", label: "Taxes" },
    { id: "other", label: "Other fees & adjustments" },
    { id: "seller-costs", label: "Seller-provided costs" },
  ]);
  for (const [id, types] of Object.entries({
    sales: ["PRODUCT_SALES", "PRODUCT_REFUNDS", "NET_PRODUCT_SALES", "RESTOCKING"],
    selling: [
      "REFERRAL_FEES",
      "REFUNDED_REFERRAL_FEES",
      "REFUND_COMMISSION",
      "DIGITAL_SERVICES_FEES",
    ],
    fulfillment: [
      "FBA_FULFILLMENT_FEES",
      "FULFILLMENT_FEE_CORRECTIONS",
      "INBOUND_PLACEMENT_FEES",
      "FBA_INBOUND_CONVENIENCE_FEE",
      "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
      "INBOUND_TRANSPORTATION_FEES",
      "INBOUND_TRANSPORTATION_PROGRAM_FEES",
      "SHIPPING_CREDITS",
      "GIFT_WRAP_CREDITS",
      "LABELING_FEES",
    ],
    inventory: [
      "STORAGE_FEES",
      "AGED_STORAGE_FEES",
      "DISPOSAL_FEES",
      "REMOVAL_FEES",
      "INVENTORY_REIMBURSEMENTS",
      "INVENTORY_REIMBURSEMENT_REVERSALS",
      "LIQUIDATION_FEES",
      "LIQUIDATION_PROCEEDS",
    ],
    advertising: [
      "ADVERTISING",
      "SPONSORED_PRODUCT_FEE",
      "SPONSORED_BRANDS",
      "SPONSORED_DISPLAY",
      "COUPON_FEES",
      "RUN_LIGHTNING_DEAL_FEE",
      "PROMOTIONAL_REBATES",
      "POINTS",
    ],
    taxes: ["PRODUCT_TAX", "TAX_WITHHELD", "TAX_RECLASSIFICATION"],
    other: [
      "ZERO_ACTIVITY",
      "SUBSCRIPTION_FEES",
      "EPR_FEES",
      "VINE_FEES",
      "INBOUND_DEFECT_FEES",
      "MCF_CREDITS",
      "OTHER_ADJUSTMENTS",
      "DEBT_RECOVERY",
      "CROSS_ACCOUNT_ADJUSTMENTS",
      "RESERVE_MOVEMENTS",
      "BANK_TRANSFERS",
    ],
    "seller-costs": [
      "COST_OF_GOODS_SOLD",
      "MFN_FULFILLMENT_COST",
      "MFN_STORAGE_COST",
      "MISCELLANEOUS_COST",
      "SHIPPING_TO_AMAZON_COST",
    ],
  })) {
    for (const type of types) assert.equal(transactionTypeGroup(type).id, id, type);
  }
  assert.equal(new Set(TRANSACTION_TYPE_GROUPS.map(({ id }) => id)).size, 8);
  for (const family of TRANSACTION_TYPE_FAMILIES)
    assert.equal(
      TRANSACTION_TYPE_GROUPS.filter(({ id }) => id === family.groupId).length,
      1,
      family.id,
    );
});

test("detailed review families remain distinct within a shared browsing group", () => {
  for (const types of [
    ["ADVERTISING", "SPONSORED_BRANDS", "SPONSORED_DISPLAY", "COUPON_FEES", "DEAL_FEES"],
    ["INBOUND_PLACEMENT_FEES", "FBA_INBOUND_PLACEMENT_SERVICE_FEE", "INBOUND_TRANSPORTATION_FEES"],
    ["STORAGE_FEES", "AGED_STORAGE_FEES", "DISPOSAL_FEES", "REMOVAL_FEES"],
  ]) {
    const familyIds = types.map((type) => {
      const entry = taxonomy.find((entry) => entry.type === type);
      assert.ok(entry, `Unregistered fixture type: ${type}`);
      return resolveTypeFamily(entry.source, type).id;
    });
    assert.equal(new Set(familyIds).size, types.length);
    assert.equal(new Set(types.map((type) => transactionTypeGroup(type).id)).size, 1);
  }
});

test("role and source scopes remain exact while unknown selections browse under Other", () => {
  for (const role of ["member", "administrator"])
    for (const dataset of ["live", "finances", "data_kiosk"]) {
      const values = transactionTypeValues(dataset, role);
      const scoped = transactionTypeGroups(
        filterOptions("component_type", values, ["UNKNOWN_STORAGE_TAX_FEE"]),
      );
      assert.deepEqual(
        new Set(scoped.flatMap(({ options }) => options.map(({ value }) => value))),
        new Set([...values, "UNKNOWN_STORAGE_TAX_FEE"]),
      );
      const other = scoped.find(({ id }) => id === "other");
      assert.ok(other.options.some(({ value }) => value === "UNKNOWN_STORAGE_TAX_FEE"));
    }
  assert.deepEqual(transactionTypeGroups([]), []);
  assert.equal(transactionTypeGroupLabel("UNKNOWN_STORAGE_TAX_FEE"), "Other fees & adjustments");
});

test("complete groups use shared selection labels while partial selections keep exact type labels", () => {
  const sales = groups.find(({ id }) => id === "sales");
  const referral = groups.find(({ id }) => id === "selling");
  assert.deepEqual(
    transactionTypeSelectionLabels(catalog, [
      ...sales.options.map(({ value }) => value),
      referral.options[0].value,
    ]),
    ["Sales & refunds", referral.options[0].label],
  );
  assert.deepEqual(transactionTypeSelectionLabels(catalog, ["PRODUCT_SALES"]), ["Product sales"]);
  assert.deepEqual(transactionTypeSelectionLabels(catalog, []), []);
  assert.deepEqual(
    transactionTypeSelectionLabels(
      catalog,
      catalog.map(({ value }) => value),
    ),
    groups.map(({ label }) => label),
  );
  assert.deepEqual(
    transactionTypeSelectionLabels(
      [...catalog, { value: "UNKNOWN_TYPE", label: "Saved unfamiliar type" }],
      ["UNKNOWN_TYPE", "ABSENT_FROM_OPTIONS", "UNKNOWN_TYPE"],
    ),
    ["Saved unfamiliar type", "ABSENT_FROM_OPTIONS"],
  );
});

test("selecting every known Other type does not hide unfamiliar saved selections", () => {
  const other = groups.find(({ id }) => id === "other");
  assert.deepEqual(
    transactionTypeSelectionLabels(
      [...catalog, { value: "UNKNOWN_TYPE", label: "Saved unfamiliar type" }],
      [
        ...other.options.map(({ value }) => value),
        "UNKNOWN_TYPE",
        "ABSENT_FROM_OPTIONS",
        "UNKNOWN_TYPE",
      ],
    ),
    ["Other fees & adjustments", "Saved unfamiliar type", "ABSENT_FROM_OPTIONS"],
  );
});

test("known codes from the wrong source remain source-specific unknown review families", () => {
  const registered = resolveTypeFamily("FINANCES", "PRODUCT_SALES");
  const otherSource = resolveTypeFamily("DATA_KIOSK", "PRODUCT_SALES");
  assert.equal(registered.id, "net-product-sales");
  assert.equal(otherSource.id, "source:DATA_KIOSK:PRODUCT_SALES");
  assert.equal(otherSource.groupId, "other");
  assert.deepEqual(otherSource.financesTypes, []);
  assert.deepEqual(otherSource.dataKioskTypes, ["PRODUCT_SALES"]);
  assert.equal(transactionTypeGroup("PRODUCT_SALES").id, "sales");
  assert.equal(transactionTypeGroup("UNKNOWN_TYPE").id, "other");
  assert.notEqual(
    resolveTypeFamily("FINANCES", "UNKNOWN_TYPE").id,
    resolveTypeFamily("DATA_KIOSK", "UNKNOWN_TYPE").id,
  );
});
