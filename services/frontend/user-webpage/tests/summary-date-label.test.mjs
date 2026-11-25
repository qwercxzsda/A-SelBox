import assert from "node:assert/strict";
import test from "node:test";
import { summaryDateLabel } from "../src/summary-date-label.ts";

test("summary date labels show both YYYY-MM-DD boundaries and say which side is open", () => {
  for (const [from, to, expected] of [
    ["2026-10-01", "2026-10-31", "2026-10-01 – 2026-10-31"],
    ["2025-12-31", "2026-01-01", "2025-12-31 – 2026-01-01"],
    ["2024-02-28", "2024-02-29", "2024-02-28 – 2024-02-29"],
    ["2026-11-06", "2026-11-06", "2026-11-06"],
    ["2026-11-06", "", "From 2026-11-06"],
    ["", "2026-11-06", "Through 2026-11-06"],
    ["", "", "Choose dates"],
  ])
    assert.equal(summaryDateLabel({ from, to }), expected);
});
