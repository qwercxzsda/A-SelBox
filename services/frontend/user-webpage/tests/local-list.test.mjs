import assert from "node:assert/strict";
import test from "node:test";
import { matchesSelection, paginateLocalList, searchLocalList } from "../src/local-list.ts";

const sku = (item) => item.sku;
const companies = new Map([
  ["company-a", "Company A"],
  ["company-b", "Company B"],
]);
const byCompany = { id: (item) => item.company_id, names: companies };

function assignment(id, value, companyId = "company-a") {
  return Object.freeze({ id, sku: value, company_id: companyId, terms_version_id: `terms-${id}` });
}

test("identifier sorting preserves exact spelling without changing the loaded list", () => {
  const rows = Object.freeze([
    assignment("a", "SKU"),
    assignment("b", "sku"),
    assignment("d", " SKU"),
    assignment("e", "SKU "),
    assignment("f", "é"),
    assignment("g", "é"),
  ]);
  const sorted = searchLocalList(rows, "", sku);
  assert.deepEqual(
    sorted.map((item) => item.sku),
    [" SKU", "SKU", "SKU ", "é", "sku", "é"],
  );
  assert.deepEqual(
    rows.map(({ id }) => id),
    ["a", "b", "d", "e", "f", "g"],
  );
  assert.deepEqual(searchLocalList([...rows].reverse(), " ", sku), sorted);
});

test("equal identifiers keep their loaded order", () => {
  const rows = [assignment("first", "SAME"), assignment("second", "SAME"), assignment("x", "A")];
  assert.deepEqual(
    searchLocalList(rows, "", sku).map(({ id }) => id),
    ["x", "first", "second"],
  );
});

test("administrator search matches company while member search uses only the identifier", () => {
  const rows = [assignment("a", "SHARED"), assignment("b", "OTHER", "company-b")];
  assert.deepEqual(searchLocalList(rows, " company a ", sku, byCompany), [rows[0]]);
  assert.deepEqual(searchLocalList(rows, "Company A", sku), []);
  assert.deepEqual(searchLocalList(rows, "shared", sku), [rows[0]]);
  const unassigned = [assignment("u", "LOOSE", null)];
  assert.deepEqual(searchLocalList(unassigned, "unassigned", sku, byCompany), unassigned);
});

test("pagination counts every match and clamps after search shrinks the result", () => {
  const rows = Array.from({ length: 26 }, (_, index) => {
    const value = `SKU-${String(index + 1).padStart(2, "0")}`;
    return assignment(value, value);
  });
  const first = paginateLocalList(rows, 0, 25);
  const last = paginateLocalList(rows, 99, 25);
  assert.equal(first.totalCount, 26);
  assert.equal(first.pageCount, 2);
  assert.deepEqual(first.visibleItems, rows.slice(0, 25));
  assert.equal(last.pageIndex, 1);
  assert.equal(last.visibleItems[0].sku, "SKU-26");
  assert.equal(last.visibleItems.length, 1);
  const filtered = paginateLocalList(searchLocalList(rows, "SKU-26", sku), 1, 25);
  assert.equal(filtered.pageIndex, 0);
  assert.equal(filtered.totalCount, 1);
  const empty = paginateLocalList(searchLocalList(rows, "absent", sku), 1, 25);
  assert.deepEqual([empty.pageIndex, empty.pageCount, empty.totalCount], [0, 1, 0]);
  assert.deepEqual(empty.visibleItems, []);
});

test("an empty selection matches every row and otherwise any overlap matches", () => {
  assert.equal(matchesSelection([], []), true);
  assert.equal(matchesSelection([], ["Amazon.de"]), true);
  assert.equal(matchesSelection(["Amazon.de"], []), false);
  assert.equal(matchesSelection(["Amazon.de"], ["Amazon.com", "Amazon.de"]), true);
  assert.equal(matchesSelection([null], [null]), true);
  assert.equal(matchesSelection(["company-a"], [null]), false);
});
