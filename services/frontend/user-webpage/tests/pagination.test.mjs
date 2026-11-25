import assert from "node:assert/strict";
import test from "node:test";
import { countLabel, pageRangeSummary, showsBottomPager } from "../src/pagination.ts";

test("counts name one item in the singular and every other count in the plural", () => {
  assert.equal(countLabel(0, "records"), "0 records");
  assert.equal(countLabel(1, "records"), "1 record");
  assert.equal(countLabel(1, "inventory items"), "1 inventory item");
  assert.equal(countLabel(1, "companies"), "1 company");
  assert.equal(countLabel(1, "SKUs"), "1 SKU");
  assert.equal(countLabel(1, "saved versions"), "1 saved version");
  assert.equal(countLabel(1_234, "transactions"), "1,234 transactions");
  assert.equal(countLabel(1, "types"), "1 type");
});

test("a noun without a known singular is rejected", () => {
  assert.throws(() => countLabel(1, "widgets"), /No singular form for "widgets"/);
  assert.throws(() => pageRangeSummary(0, 25, 2, null, "widgets"), /No singular form/);
});

test("page summaries show a range, a single row, or the whole list", () => {
  assert.equal(pageRangeSummary(0, 25, 25, 120, "users"), "1–25 of 120 users");
  assert.equal(pageRangeSummary(1, 25, 1, 26, "users"), "26 of 26 users");
  assert.equal(pageRangeSummary(0, 25, 1, 1, "users"), "1 user");
  assert.equal(pageRangeSummary(0, 25, 1, 1, "latest reports"), "1 latest report");
  assert.equal(pageRangeSummary(0, 25, 0, 0, "assignments"), "0 assignments");
  assert.equal(pageRangeSummary(2, 25, 0, 30, "companies"), "0 of 30 companies");
  assert.equal(pageRangeSummary(0, 50, 50, 1_000, "records"), "1–50 of 1,000 records");
});

test("a page summary without a count yet keeps the range and the plural noun", () => {
  assert.equal(pageRangeSummary(0, 25, 25, null, "transactions"), "1–25 of — transactions");
  assert.equal(pageRangeSummary(0, 25, 1, null, "SKUs"), "1 of — SKUs");
});

test("the pager below a list appears for long lists and later pages", () => {
  assert.equal(showsBottomPager(10, 0), false);
  assert.equal(showsBottomPager(11, 0), true);
  assert.equal(showsBottomPager(3, 1), true);
});
