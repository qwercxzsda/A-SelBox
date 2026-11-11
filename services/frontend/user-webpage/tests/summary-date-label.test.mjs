import assert from "node:assert/strict";
import test from "node:test";
import { summaryDateLabel } from "../src/summary-date-label.ts";

test("summary date labels remove repeated month and year without changing boundaries", () => {
  for (const [from, to, expected] of [
    ["2026-10-01", "2026-10-31", "Oct 1–31, 2026"],
    ["2026-10-01", "2026-11-06", "Oct 1 – Nov 6, 2026"],
    ["2025-12-31", "2026-01-01", "Dec 31, 2025 – Jan 1, 2026"],
    ["2024-02-28", "2024-02-29", "Feb 28–29, 2024"],
    ["2026-11-06", "2026-11-06", "Nov 6, 2026"],
    ["2026-11-06", "", "From Nov 6, 2026"],
    ["", "2026-11-06", "Through Nov 6, 2026"],
    ["", "", "Choose dates"],
  ])
    assert.equal(summaryDateLabel({ from, to }), expected);
});
