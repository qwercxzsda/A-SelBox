import assert from "node:assert/strict";
import test from "node:test";
import { isFeeRate } from "../src/api/sku-configuration-codec.ts";
import {
  clearSubmittedDrafts,
  createSkuDraft,
  formPaths,
  movePeriodPaths,
  newSkuItem,
  resolveSkuConfiguration,
  showsFieldError,
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

test("a removed company blocks fee publication without rewriting the retained draft", () => {
  const saved = item();
  const draft = { ...createSkuDraft(saved), company_id: "deleted-company" };
  const result = resolveSkuConfiguration([saved], [draft], new Set([saved.company_id]));
  assert.equal(result.items[0].company_id, "deleted-company");
  assert.equal(draft.company_id, "deleted-company");
  assert.deepEqual(result.issuesBySku.get(saved.sku), [
    {
      sku: saved.sku,
      field: "company_id",
      message: "This company is no longer available. Choose another company.",
      periodIndex: undefined,
    },
  ]);
  assert.deepEqual(resolveSkuConfiguration([saved], [], new Set([saved.company_id])).issues, []);
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
  assert.deepEqual(gaps[0].gap, required("2026-01-15", "2026-01-16"));
  assert.equal(gaps[0].field, undefined);
  assert.doesNotMatch(gaps[0].message, /inclusive|exclusive/);
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
test("global readiness includes untouched SKUs while publication validates only staged changes", () => {
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
  assert.deepEqual(resolveSkuConfiguration(saved, drafts).draftIssues, []);
  const invalid = createSkuDraft(newSkuItem("S2"));
  assert.deepEqual(
    resolveSkuConfiguration(saved, [...drafts, invalid]).draftIssues.map((issue) => [
      issue.sku,
      issue.field,
    ]),
    [["S2", "company_id"]],
  );
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
  assert.deepEqual(
    issues.filter((issue) => issue.gap).map((issue) => issue.gap),
    [{ marketplace_name: "Amazon.com", valid_from: "2026-02-01", valid_to: "2026-03-01" }],
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
    issues.some((issue) => issue.gap),
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

test("publication completion retains every newer fee edit, including incomplete values", () => {
  const submitted = createSkuDraft(item());
  for (const change of [
    { marketplace_name: "Amazon.co.uk" },
    { valid_from: "2025-12-31" },
    { valid_to: "2026-02-01" },
    { fee_rate_percent: "5.123457" },
    { fee_rate_percent: "" },
  ]) {
    const newer = { ...submitted, periods: [{ ...submitted.periods[0], ...change }] };
    assert.deepEqual(clearSubmittedDrafts([newer], [submitted]), [newer]);
  }
  const removed = { ...submitted, periods: [] };
  const added = { ...submitted, periods: [...submitted.periods, period("2026-02-01", null)] };
  assert.deepEqual(clearSubmittedDrafts([removed], [submitted]), [removed]);
  assert.deepEqual(clearSubmittedDrafts([added], [submitted]), [added]);
});

test("clearing a saved owner permits unassigned amounts without a fee rate", () => {
  const saved = item({ periods: [] });
  const clear = { ...createSkuDraft(saved), company_id: null, periods: [] };
  assert.deepEqual(resolveSkuConfiguration([saved], [clear]).draftIssues, []);
});

const shownErrors = (opened, values, visited = []) =>
  validateSkuItem({ ...opened, ...values })
    .filter((issue) => issue.field && showsFieldError(issue, values, visited))
    .map(({ message, periodIndex }) => [periodIndex, message]);

test("a blank field shows its error only after a visit; a filled-in value at once", () => {
  const saved = item({ requirements: [required("2026-01-01", "2026-02-01", "Amazon.de")] });
  const draft = createSkuDraft(saved);
  // The pre-added gap period starts with an empty rate: no error before the user reaches it.
  assert.equal(draft.periods[1].fee_rate_percent, "");
  assert.deepEqual(shownErrors(saved, draft), []);
  assert.deepEqual(shownErrors(saved, draft, ["periods.1.fee_rate_percent"]), [
    [1, "Enter 0–100, up to 6 decimals."],
  ]);
  // Clearing a saved rate types into it, so the field is visited; an invalid value shows at once.
  const cleared = { ...draft, periods: [{ ...draft.periods[0], fee_rate_percent: "" }] };
  assert.deepEqual(shownErrors(saved, cleared), []);
  assert.deepEqual(shownErrors(saved, cleared, ["periods.0.fee_rate_percent"]), [
    [0, "Enter 0–100, up to 6 decimals."],
  ]);
  const typed = { ...draft, periods: [{ ...draft.periods[0], valid_to: "2025-01-01" }] };
  assert.deepEqual(shownErrors(saved, typed), [
    [0, "Effective until must be after Effective from."],
  ]);
  // A new SKU's blank company and added period stay quiet until visited.
  const opened = newSkuItem("S2");
  const added = { ...createSkuDraft(opened), periods: [period("", null, "", "")] };
  assert.deepEqual(shownErrors(opened, added), []);
  assert.deepEqual(shownErrors(opened, added, ["company_id", "periods.0.marketplace_name"]), [
    [undefined, "Choose a company."],
    [0, "Choose a marketplace."],
  ]);
});

test("blank periods stay quiet when removing a period shifts them onto a saved period's index", () => {
  // Remove period 2 of two saved periods, then add a blank period at index 1.
  const twoPeriods = item({
    requirements: [],
    periods: [period("2026-01-01", "2026-02-01"), period("2026-02-01", null, "6")],
  });
  const draft = createSkuDraft(twoPeriods);
  const visited = movePeriodPaths([], 1, -1);
  const added = { ...draft, periods: [draft.periods[0], period("", null, "", "")] };
  assert.deepEqual(shownErrors(twoPeriods, added, visited), []);
  // Removing period 1 moves the pre-added gap period (blank rate) from index 2 to index 1.
  const withGap = item({
    requirements: [required("2026-01-01", "2026-04-01")],
    periods: [period("2026-01-01", "2026-02-01"), period("2026-03-01", null, "6")],
  });
  const gapDraft = createSkuDraft(withGap);
  assert.equal(gapDraft.periods.length, 3);
  assert.deepEqual(shownErrors(withGap, gapDraft), []);
  const removed = { ...gapDraft, periods: gapDraft.periods.slice(1) };
  assert.deepEqual(shownErrors(withGap, removed, movePeriodPaths([], 0, -1)), []);
  // A visited field keeps its error on its period after the move.
  assert.deepEqual(
    shownErrors(withGap, removed, movePeriodPaths(["periods.2.fee_rate_percent"], 0, -1)),
    [[1, "Enter 0–100, up to 6 decimals."]],
  );
});

test("visited period paths follow their periods when periods are removed or inserted", () => {
  const paths = [
    "company_id",
    "periods.0.valid_to",
    "periods.1.fee_rate_percent",
    "periods.2.valid_from",
  ];
  assert.deepEqual(movePeriodPaths(paths, 1, -1), [
    "company_id",
    "periods.0.valid_to",
    "periods.1.valid_from",
  ]);
  assert.deepEqual(movePeriodPaths(paths, 1, 1), [
    "company_id",
    "periods.0.valid_to",
    "periods.2.fee_rate_percent",
    "periods.3.valid_from",
  ]);
  assert.deepEqual(movePeriodPaths(paths, 0, 0), paths);
});

test("a kept draft reopens with every field visited, so all of its errors show", () => {
  const saved = item({ company_id: null, requirements: [required("2026-01-01", "2026-03-01")] });
  const kept = { ...createSkuDraft(saved), periods: [period("2026-01-01", null, "")] };
  assert.deepEqual(formPaths(kept), [
    "company_id",
    "periods.0.marketplace_name",
    "periods.0.fee_rate_percent",
    "periods.0.valid_from",
    "periods.0.valid_to",
  ]);
  assert.deepEqual(shownErrors(saved, kept, formPaths(kept)), [
    [undefined, "Choose a company."],
    [0, "Enter 0–100, up to 6 decimals."],
  ]);
});
