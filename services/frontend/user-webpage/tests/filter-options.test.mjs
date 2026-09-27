import assert from "node:assert/strict";
import test from "node:test";
import marketplaces from "../src/generated/marketplaces.json" with { type: "json" };
import registry from "../src/generated/transaction-types.json" with { type: "json" };
import { filterOptions, localFilterValues, transactionTypeValues } from "../src/filter-options.ts";

test("source and marketplace menus are complete even without facts or assignments", () => {
  for (const role of ["company_member", "operator"]) {
    assert.deepEqual(localFilterValues("source", "live", role, []), ["SETTLEMENT", "DATA_KIOSK"]);
    const values = localFilterValues("marketplace_name", "live", role, []);
    assert.deepEqual(values, marketplaces);
    assert.equal(new Set(values).size, 24);
    assert.ok(values.includes("Amazon.com"));
    assert.ok(values.includes("Amazon.co.za"));
  }
});

test("Transactions types include all known categories except SELBOX for members", () => {
  for (const role of ["company_member", "operator"]) {
    const values = transactionTypeValues("live", role);
    for (const type of [
      "PRODUCT_SALES",
      "FBA_STORAGE_FEE",
      "NET_PRODUCT_SALES",
      "COST_OF_GOODS_SOLD",
      "FBAFees/FBA Inventory Storage Fee/Base fee",
    ])
      assert.ok(values.includes(type), `${role} should see ${type}`);
    assert.equal(
      values.includes("other-transaction/other-transaction/Subscription Fee"),
      role === "operator",
    );
    assert.equal(values.includes("SUBSCRIPTION_FEE"), role === "operator");
  }
  assert.deepEqual(
    new Set(transactionTypeValues("live", "operator")),
    new Set(registry.map(({ type }) => type)),
  );
  assert.deepEqual(
    new Set(transactionTypeValues("live", "company_member")),
    new Set(registry.filter(({ category }) => category !== "SELBOX").map(({ type }) => type)),
  );
});

test("raw administrator tabs retain every known type in their respective source", () => {
  for (const [dataset, source] of [
    ["settlement", "SETTLEMENT"],
    ["data_kiosk", "DATA_KIOSK"],
  ]) {
    assert.deepEqual(
      new Set(transactionTypeValues(dataset, "operator")),
      new Set(registry.filter((entry) => entry.source === source).map(({ type }) => type)),
    );
    assert.deepEqual(
      new Set(transactionTypeValues(dataset, "company_member")),
      new Set(
        registry
          .filter((entry) => entry.source === source && entry.category !== "SELBOX")
          .map(({ type }) => type),
      ),
    );
  }
  assert.deepEqual(transactionTypeValues("accounts", "operator"), []);
});

test("both roles use their preloaded SKU catalog without changing exact keys", () => {
  const values = ["A", "  Exact, SKU  "];
  for (const role of ["company_member", "operator"]) {
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
