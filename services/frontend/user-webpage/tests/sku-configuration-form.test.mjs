import assert from "node:assert/strict";
import test from "node:test";
import { isFeeRate } from "../src/api/sku-configuration-codec.ts";
import {
  createSkuDraft,
  clearSubmittedDrafts,
  newSkuItem,
  resolveSkuConfiguration,
  validateSkuItem,
} from "../src/sku-configuration-form.ts";

const period = (from, to, rate = "5.123456", market = "Amazon.com") => ({
  marketplace_name: market,
  valid_from: from,
  valid_to: to,
  fee_rate_percent: rate,
});
const required = (from, to, market = "Amazon.com") => ({
  marketplace_name: market,
  valid_from: from,
  valid_to: to,
});
const item = (overrides = {}) => ({
  ...newSkuItem("S1"),
  company_id: "company-a",
  terms_version_id: "version-a",
  requirements: [required("2026-01-01", "2026-02-01")],
  periods: [period("2026-01-01", null)],
  ...overrides,
});

test("rates accept exact zero and six decimals without inventing blank or rounded fees", () => {
  for (const value of ["0", "0.000000", ".5", "5.123456", "100.000000"])
    assert.equal(isFeeRate(value), true, value);
  for (const value of ["", " ", "100.000001", "5.1234567", "-1", "NaN", "1e2", "5,2"])
    assert.equal(isFeeRate(value), false, value);
});
test("coverage accepts adjoining and open-ended rates but identifies exact half-open gaps", () => {
  assert.deepEqual(
    validateSkuItem(
      item({ periods: [period("2026-01-01", "2026-01-15"), period("2026-01-15", null, "0")] }),
    ),
    [],
  );
  const gaps = validateSkuItem(
    item({ periods: [period("2026-01-01", "2026-01-15"), period("2026-01-16", null)] }),
  );
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /2026-01-15 \(inclusive\) to 2026-01-16 \(exclusive\)/);
});
test("dates, marketplace overlap, and invalid rates cannot provide required coverage", () => {
  assert.ok(
    validateSkuItem(item({ periods: [period("2026-02-30", null)] })).some(
      (issue) => issue.field === "valid_from",
    ),
  );
  assert.ok(
    validateSkuItem(item({ periods: [period("2026-01-01", "2026-01-01")] })).some(
      (issue) => issue.field === "valid_to",
    ),
  );
  assert.ok(
    validateSkuItem(
      item({ periods: [period("2026-01-01", null), period("2026-01-15", null)] }),
    ).some((issue) => issue.message.includes("overlap")),
  );
  assert.equal(
    validateSkuItem(item({ periods: [period("2026-01-01", null, "0", "Amazon.co.jp")] })).length,
    1,
  );
  assert.ok(
    validateSkuItem(item({ periods: [period("2026-01-01", null, "")] })).some(
      (issue) => !issue.field,
    ),
  );
});
test("draft creation preserves saved rates and prefills only uncovered intervals with blank rates", () => {
  const saved = item({ periods: [period("2026-01-01", "2026-01-15")] });
  const draft = createSkuDraft(saved);
  assert.equal(draft.expected_current_version_id, "version-a");
  assert.deepEqual(draft.periods, [saved.periods[0], period("2026-01-15", "2026-02-01", "")]);
  draft.periods[0].fee_rate_percent = "6";
  assert.equal(saved.periods[0].fee_rate_percent, "5.123456");
});
test("global checks require an owner even without commission data and include untouched/new SKUs", () => {
  const saved = [item(), newSkuItem("S2")];
  const drafts = [
    { ...createSkuDraft(item()), company_id: "company-b" },
    { ...createSkuDraft(newSkuItem(" S3 ")), company_id: "company-b" },
  ];
  assert.deepEqual(
    resolveSkuConfiguration(saved, drafts).issues.map((issue) => [issue.sku, issue.field]),
    [["S2", "company_id"]],
  );
  assert.equal(resolveSkuConfiguration(saved, drafts).items[0].sku, " S3 ");
  assert.equal(saved[0].company_id, "company-a");
});

test("new marketplaces prefill one ongoing blank rate from the earliest required date", () => {
  const draft = createSkuDraft(
    item({
      periods: [],
      requirements: [required("2026-09-01", "2026-09-02"), required("2026-01-01", "2026-01-02")],
    }),
  );
  assert.deepEqual(draft.periods, [period("2026-01-01", null, "")]);
});

test("a confirmed publication clears only the submitted draft snapshot", () => {
  const submitted = createSkuDraft(item());
  const newer = { ...submitted, company_id: "company-new" };
  const other = createSkuDraft(item({ sku: "S2" }));
  assert.deepEqual(clearSubmittedDrafts([submitted, other], [submitted]), [other]);
  assert.deepEqual(clearSubmittedDrafts([newer, other], [submitted]), [newer, other]);
});
test("source refresh adds new coverage requirements and stale drafts cannot silently overwrite settings", () => {
  const original = item({ periods: [period("2026-01-01", "2026-02-01")] });
  const draft = createSkuDraft(original);
  const refreshed = {
    ...original,
    terms_version_id: "version-b",
    requirements: [required("2026-01-01", "2026-03-01")],
  };
  const issues = resolveSkuConfiguration([refreshed], [draft]).issues;
  assert.ok(
    issues.some((issue) =>
      issue.message.includes("2026-02-01 (inclusive) to 2026-03-01 (exclusive)"),
    ),
  );
  assert.ok(issues.some((issue) => issue.message.includes("Saved settings changed")));
});

test("valid adjacent fee history remains fully covered across a large set of requirements", () => {
  const date = (day) => new Date(Date.UTC(2020, 0, 1 + day)).toISOString().slice(0, 10);
  const periods = Object.freeze(
    Array.from({ length: 1500 }, (_, index) =>
      Object.freeze(period(date(index), date(index + 1), index % 2 ? "0" : "5.123456")),
    ),
  );
  const requirements = Array.from({ length: 1500 }, (_, index) =>
    required(date(index), date(index + 1)),
  );
  assert.deepEqual(validateSkuItem(item({ periods, requirements })), []);
  assert.equal(createSkuDraft(item({ periods, requirements })).periods.length, periods.length);
});

test("out-of-order overlapping rates are rejected even when their union covers all required dates", () => {
  const issues = validateSkuItem(
    item({
      periods: [
        period("2026-01-20", "2026-01-25"),
        period("2026-01-10", "2026-02-01"),
        period("2026-01-01", null),
      ],
    }),
  );
  assert.ok(issues.some((issue) => issue.message.includes("overlap")));
  assert.equal(
    issues.some((issue) => issue.message.includes("needs a fee rate")),
    false,
  );
});

test("submitted snapshots compare fields rather than JSON property order", () => {
  const submitted = createSkuDraft(item());
  const reordered = {
    periods: submitted.periods.map((row) => ({
      fee_rate_percent: row.fee_rate_percent,
      valid_to: row.valid_to,
      marketplace_name: row.marketplace_name,
      valid_from: row.valid_from,
    })),
    expected_current_version_id: submitted.expected_current_version_id,
    company_id: submitted.company_id,
    sku: submitted.sku,
  };
  assert.deepEqual(clearSubmittedDrafts([reordered], [submitted]), []);
});
