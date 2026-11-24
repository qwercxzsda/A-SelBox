import assert from "node:assert/strict";
import test from "node:test";
import marketplaces from "../src/generated/marketplaces.json" with { type: "json" };
import registry from "../src/generated/transaction-types.json" with { type: "json" };
import { filterOptions, localFilterValues, transactionTypeValues } from "../src/filter-options.ts";

test("source and marketplace menus are complete even without facts or assignments", () => {
  for (const role of ["member", "administrator"]) {
    assert.deepEqual(localFilterValues("source", "live", role, []), [
      "FINANCES",
      "AD_INVOICE",
      "STORAGE",
      "AGED_STORAGE",
      "REMOVAL_ORDER",
    ]);
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

test("Transactions excludes transfers and limits SelBox types to administrators", () => {
  for (const role of ["member", "administrator"]) {
    const expected = registry
      .filter(
        ({ type, selbox_group }) =>
          type !== "BANK_TRANSFERS" && (!selbox_group || role === "administrator"),
      )
      .map((row) => row.type);
    assert.deepEqual(new Set(transactionTypeValues("live", role)), new Set(expected));
  }
});

test("raw administrator tabs retain every known type in their respective source", () => {
  assert.deepEqual(
    new Set(transactionTypeValues("finances", "administrator")),
    new Set(registry.map(({ type }) => type)),
  );
  assert.deepEqual(transactionTypeValues("finances", "member"), []);
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
  assert.deepEqual(filterOptions("source", ["STORAGE"]), [
    { value: "STORAGE", label: "Monthly storage report", title: undefined },
  ]);
  assert.deepEqual(filterOptions("component_type", [], ["PRODUCT_SALES"]), [
    { value: "PRODUCT_SALES", label: "Product sales", title: "PRODUCT_SALES" },
  ]);
});
