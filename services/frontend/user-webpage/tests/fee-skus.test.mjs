import assert from "node:assert/strict";
import test from "node:test";
import { filterFeeSkus, paginateFeeSkus } from "../src/fee-skus.ts";

function assignment(id, sku, companyId = "company-a") {
  return Object.freeze({ id, sku, company_id: companyId, terms_version_id: `terms-${id}` });
}

test("SKU sorting preserves exact spelling without changing assignments", () => {
  const rows = Object.freeze([
    assignment("a", "SKU"),
    assignment("b", "sku"),
    assignment("d", " SKU"),
    assignment("e", "SKU "),
    assignment("f", "é"),
    assignment("g", "e\u0301"),
  ]);
  const sorted = filterFeeSkus(rows, "");
  assert.deepEqual(
    sorted.map(({ sku }) => sku),
    [" SKU", "SKU", "SKU ", "e\u0301", "sku", "é"],
  );
  assert.deepEqual(
    rows.map(({ id }) => id),
    ["a", "b", "d", "e", "f", "g"],
  );
  assert.deepEqual(filterFeeSkus([...rows].reverse(), " "), sorted);
});

test("administrator search matches company while member search uses only SKU", () => {
  const companies = new Map([
    ["company-a", "Company A"],
    ["company-b", "Company B"],
  ]);
  const rows = [assignment("a", "SHARED"), assignment("b", "OTHER", "company-b")];
  assert.deepEqual(filterFeeSkus(rows, " company a ", companies), [rows[0]]);
  assert.deepEqual(filterFeeSkus(rows, "Company A"), []);
  assert.deepEqual(filterFeeSkus(rows, "shared"), [rows[0]]);
});

test("SKU pagination counts assignments and clamps after search shrinks the result", () => {
  const rows = Array.from({ length: 26 }, (_, index) => {
    const sku = `SKU-${String(index + 1).padStart(2, "0")}`;
    return assignment(sku, sku);
  });
  const first = paginateFeeSkus(rows, 0, 25);
  const last = paginateFeeSkus(rows, 99, 25);
  assert.equal(first.totalCount, 26);
  assert.equal(first.pageCount, 2);
  assert.equal(first.visibleSkus.length, 25);
  assert.deepEqual([first.firstVisible, first.lastVisible], [1, 25]);
  assert.equal(last.pageIndex, 1);
  assert.equal(last.visibleSkus[0].sku, "SKU-26");
  assert.deepEqual([last.firstVisible, last.lastVisible], [26, 26]);
  const filtered = paginateFeeSkus(filterFeeSkus(rows, "SKU-26"), 1, 25);
  assert.equal(filtered.pageIndex, 0);
  assert.equal(filtered.totalCount, 1);
  const empty = paginateFeeSkus(filterFeeSkus(rows, "absent"), 1, 25);
  assert.deepEqual(
    [empty.pageIndex, empty.pageCount, empty.firstVisible, empty.lastVisible],
    [0, 1, 0, 0],
  );
  assert.deepEqual(empty.visibleSkus, []);
});
