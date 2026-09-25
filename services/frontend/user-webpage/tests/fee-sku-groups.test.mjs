import assert from "node:assert/strict";
import test from "node:test";
import {
  feeSkuCompanyLabels,
  filterFeeSkuGroups,
  groupFeeSkus,
  paginateFeeSkuGroups,
} from "../src/fee-sku-groups.ts";

function assignment(id, sku, companyId = "company-a", seller = "hidden-seller") {
  return Object.freeze({
    id,
    sku,
    company_id: companyId,
    seller_namespace: seller,
    terms_version_id: `terms-${id}`,
  });
}

test("exact SKU groups retain every assignment across companies and sellers without normalizing identity", () => {
  const rows = Object.freeze([
    assignment("z", "SKU", "company-b", "seller-b"),
    assignment("b", "sku"),
    assignment("a", "SKU", "company-a", "seller-a"),
    assignment("d", " SKU"),
    assignment("e", "SKU "),
    assignment("f", "é"),
    assignment("g", "e\u0301"),
  ]);
  const groups = groupFeeSkus(rows);
  assert.deepEqual(
    groups.map((group) => group.sku),
    [" SKU", "SKU", "SKU ", "e\u0301", "sku", "é"],
  );
  assert.deepEqual(groups[1].assignments, [rows[2], rows[0]]);
  assert.equal(groups.flatMap((group) => group.assignments).length, rows.length);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["z", "b", "a", "d", "e", "f", "g"],
  );
  assert.deepEqual(groupFeeSkus([...rows].reverse()), groups);
});

test("company search selects the full SKU while member search and all searches ignore seller names", () => {
  const companies = new Map([
    ["company-a", "Company A"],
    ["company-b", "Company B"],
  ]);
  const groups = groupFeeSkus([
    assignment("a", "SHARED", "company-a", "seller-secret-a"),
    assignment("b", "SHARED", "company-b", "seller-secret-b"),
    assignment("c", "SHARED", "company-a", "seller-secret-c"),
    assignment("d", "OTHER", "company-b"),
  ]);
  const matches = filterFeeSkuGroups(groups, " company a ", companies);
  assert.equal(matches.length, 1);
  assert.equal(matches[0], groups[1]);
  assert.deepEqual(
    matches[0].assignments.map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(feeSkuCompanyLabels(matches[0], companies), ["Company A", "Company B"]);
  assert.deepEqual(filterFeeSkuGroups(groups, "Company A"), []);
  assert.deepEqual(filterFeeSkuGroups(groups, "seller-secret", companies), []);
  assert.deepEqual(filterFeeSkuGroups(groups, "seller-secret"), []);
  assert.equal(filterFeeSkuGroups(groups, "shared")[0], groups[1]);
  assert.equal(filterFeeSkuGroups(groups, "   ", companies), groups);
});

test("pagination counts complete SKU groups and clamps after a search shrinks the result", () => {
  const assignments = Array.from({ length: 26 }, (_, index) => {
    const sku = `SKU-${String(index + 1).padStart(2, "0")}`;
    return [assignment(`${sku}-b`, sku), assignment(`${sku}-a`, sku)];
  }).flat();
  const groups = groupFeeSkus(assignments);
  const first = paginateFeeSkuGroups(groups, 0, 25);
  const last = paginateFeeSkuGroups(groups, 99, 25);
  assert.equal(first.totalCount, 26);
  assert.equal(first.pageCount, 2);
  assert.equal(first.visibleGroups.length, 25);
  assert.deepEqual([first.firstVisible, first.lastVisible], [1, 25]);
  assert.equal(first.visibleGroups.flatMap((group) => group.assignments).length, 50);
  assert.equal(last.pageIndex, 1);
  assert.equal(last.visibleGroups[0].sku, "SKU-26");
  assert.equal(last.visibleGroups[0].assignments.length, 2);
  assert.deepEqual([last.firstVisible, last.lastVisible], [26, 26]);

  const filtered = paginateFeeSkuGroups(filterFeeSkuGroups(groups, "SKU-26"), 1, 25);
  assert.equal(filtered.pageIndex, 0);
  assert.equal(filtered.totalCount, 1);
  assert.equal(filtered.visibleGroups[0].assignments.length, 2);
  const empty = paginateFeeSkuGroups(filterFeeSkuGroups(groups, "absent"), 1, 25);
  assert.deepEqual(
    [empty.pageIndex, empty.pageCount, empty.firstVisible, empty.lastVisible],
    [0, 1, 0, 0],
  );
  assert.deepEqual(empty.visibleGroups, []);
});
