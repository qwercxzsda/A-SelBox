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

test("search matches group names or exact type words without broadening to siblings", () => {
  assert.deepEqual(searchTransactionTypeGroups(groups, "  "), groups);
  assert.deepEqual(searchTransactionTypeGroups(groups, "storage inventory"), [
    groups.find(({ id }) => id === "inventory"),
  ]);
  const values = (search) =>
    searchTransactionTypeGroups(groups, search).flatMap(({ options }) =>
      options.map(({ value }) => value),
    );
  assert.ok(values("storage fee").includes("STORAGE_FEES"));
  assert.ok(!values("storage fee").includes("DISPOSAL_FEE"));
  assert.deepEqual(values("AGED_STORAGE_FEES"), ["AGED_STORAGE_FEES"]);
  assert.deepEqual(values("inventory disposal"), []);
  assert.deepEqual(values("no such type"), []);
});

test("role and source scopes remain exact while unknown selections browse under Other", () => {
  for (const role of ["member", "administrator"])
    for (const dataset of ["live", "finances"]) {
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
