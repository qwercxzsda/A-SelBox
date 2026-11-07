import assert from "node:assert/strict";
import test from "node:test";
import marketplaces from "../src/generated/marketplaces.json" with { type: "json" };
import registry from "../src/generated/transaction-types.json" with { type: "json" };
import { filterOptions, localFilterValues, transactionTypeValues } from "../src/filter-options.ts";

test("source and marketplace menus are complete even without facts or assignments", () => {
  for (const role of ["member", "administrator"]) {
    assert.deepEqual(localFilterValues("source", "live", role, []), ["FINANCES", "DATA_KIOSK"]);
    const values = localFilterValues("marketplace_name", "live", role, []);
    assert.deepEqual(values, marketplaces);
    assert.equal(new Set(values).size, marketplaces.length);
    assert.ok(values.includes("Amazon.com"));
    assert.ok(values.includes("Amazon.co.za"));
    assert.ok(values.includes("Non-Amazon DE"));
    assert.ok(values.includes("Non-Amazon IT"));
    assert.ok(values.includes("Amazon.it"));
  }
});

test("Transactions types follow fixed source authority and keep SELBOX administrator-only", () => {
  for (const role of ["member", "administrator"]) {
    const values = transactionTypeValues("live", role);
    for (const type of [
      "PRODUCT_SALES",
      "FBA_STORAGE_FEE",
      "REFERRAL_FEES",
      "RUN_LIGHTNING_DEAL_FEE",
    ])
      assert.ok(values.includes(type), `${role} should see ${type}`);
    assert.equal(values.includes("SUBSCRIPTION_FEES"), role === "administrator");
    for (const type of [
      "NET_PRODUCT_SALES",
      "COST_OF_GOODS_SOLD",
      "STORAGE_FEES",
      "SUBSCRIPTION_FEE",
    ])
      assert.equal(values.includes(type), false, `${role} should not offer ${type}`);
  }
  assert.deepEqual(
    new Set(transactionTypeValues("live", "administrator")),
    new Set(
      registry
        .filter(
          ({ source, category }) =>
            (source === "FINANCES" && ["FINANCES", "SELBOX"].includes(category)) ||
            (source === "DATA_KIOSK" && category === "DATA_KIOSK"),
        )
        .map(({ type }) => type),
    ),
  );
  assert.deepEqual(
    new Set(transactionTypeValues("live", "member")),
    new Set(registry.filter(({ source, category }) => source === category).map(({ type }) => type)),
  );
});

test("raw administrator tabs retain every known type in their respective source", () => {
  for (const [dataset, source] of [
    ["finances", "FINANCES"],
    ["data_kiosk", "DATA_KIOSK"],
  ]) {
    assert.deepEqual(
      new Set(transactionTypeValues(dataset, "administrator")),
      new Set(registry.filter((entry) => entry.source === source).map(({ type }) => type)),
    );
    assert.deepEqual(new Set(transactionTypeValues(dataset, "member")), new Set());
  }
  assert.deepEqual(transactionTypeValues("accounts", "administrator"), []);
  assert.deepEqual(transactionTypeValues("live", "unassigned"), []);
});

test("both roles use their preloaded SKU catalog without changing exact keys", () => {
  const values = ["A", "  Exact, SKU  "];
  for (const role of ["member", "administrator"]) {
    assert.deepEqual(localFilterValues("sku", "live", role, values), values);
  }
});

test("options deduplicate exact keys, format labels, and retain selections outside current choices", () => {
  const skuOptions = filterOptions("sku", ["A", "A", " A "], ["REMOVED", "A"]);
  assert.equal(skuOptions.length, 3);
  assert.deepEqual(new Set(skuOptions.map(({ value }) => value)), new Set(["A", " A ", "REMOVED"]));
  assert.deepEqual(filterOptions("source", ["DATA_KIOSK"]), [
    { value: "DATA_KIOSK", label: "Data Kiosk", title: undefined },
  ]);
  assert.deepEqual(filterOptions("component_type", [], ["PRODUCT_SALES"]), [
    { value: "PRODUCT_SALES", label: "Product sales", title: "PRODUCT_SALES" },
  ]);
});
