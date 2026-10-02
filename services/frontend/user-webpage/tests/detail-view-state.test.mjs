import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDetailPage,
  decodeRecordSelection,
  decodeSummaryBreakdown,
} from "../src/detail-view-state.ts";

test("restored estimate scope excludes cached amounts and validates query bounds", () => {
  const input = {
    title: "Selected dates",
    currency: "USD",
    period: {
      label: "June 2026",
      range: { from: "2026-06-01", to: "2026-06-30" },
      totals: [{ companyAmount: "999" }],
    },
    scope: { companyIds: [], skus: ['A,(quoted)"'], marketplaces: ["Amazon.com"] },
  };
  const restored = decodeSummaryBreakdown(input);
  assert.deepEqual(restored.period, { label: "June 2026", range: input.period.range });
  assert.deepEqual(restored.scope, input.scope);
  for (const invalid of [
    { ...input, currency: "usd" },
    { ...input, scope: { ...input.scope, companyIds: ["not-a-company"] } },
    { ...input, scope: { ...input.scope, skus: ["SKU", "SKU"] } },
    { ...input, period: { ...input.period, range: { from: "2026-02-30", to: "2026-03-01" } } },
  ])
    assert.equal(decodeSummaryBreakdown(invalid), null);
});

test("reload retains the page/filter generation while invalid state is discarded", () => {
  assert.equal(decodeDetailPage(3), 3);
  for (const value of [-1, 1.5, Infinity, "3", {}, 1_000_001])
    assert.equal(decodeDetailPage(value), 0);
  assert.deepEqual(decodeRecordSelection({ label: "All records", types: [], revision: 7 }), {
    label: "All records",
    types: [],
    revision: 7,
  });
  assert.deepEqual(
    decodeRecordSelection({ label: "Storage", types: ["FBA_STORAGE_FEE"], revision: 3 }),
    { label: "Storage", types: ["FBA_STORAGE_FEE"], revision: 3 },
  );
  assert.deepEqual(decodeRecordSelection(null), { label: "All records", types: [] });
});
