import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryAge,
  inventoryEmptyMessage,
  inventoryReportRanges,
  inventorySourceDay,
} from "../src/inventory-coverage.ts";

const now = Date.parse("2026-10-18T12:00:00Z");
const captures = [{ marketplace_name: "Amazon.com" }];

test("inventory age uses source days, normalizes timestamp zones and flags overdue daily sources", () => {
  assert.deepEqual(inventoryAge("2026-10-18", now), { label: "Today (UTC)", overdue: false });
  assert.deepEqual(inventoryAge("2026-10-16", now), { label: "2 days old", overdue: false });
  assert.deepEqual(inventoryAge("2026-10-15", now), { label: "3 days old", overdue: true });
  assert.deepEqual(inventoryAge("2026-10-03", now), { label: "15 days old", overdue: true });
  assert.equal(inventorySourceDay("2026-10-18T00:30:00+02:00"), "2026-10-17");
  assert.equal(inventorySourceDay("2026-10-18 23:30:00-02"), "2026-10-19");
  assert.equal(inventorySourceDay("2026-02-30"), null);
  assert.equal(inventoryAge(null, now).label, "Date unavailable");
  assert.deepEqual(inventoryAge("2026-10-19", now), {
    label: "Future source date — check source",
    overdue: false,
  });
});

test("marketplace report ranges retain the oldest source date across captures and unknown dates", () => {
  const sources = [
    { marketplace_name: "Amazon.co.jp", report_created_at: "invalid" },
    { marketplace_name: "Amazon.com", report_created_at: "2026-10-18T01:00:00Z" },
    { marketplace_name: "Amazon.com", report_created_at: "2026-10-03T03:00:00Z" },
    { marketplace_name: "Amazon.com", report_created_at: "invalid" },
    { marketplace_name: "Amazon.de", report_created_at: "2026-10-16T01:00:00Z" },
  ];
  const ranges = inventoryReportRanges(sources, "");
  assert.deepEqual(ranges, [
    { marketplaceName: "Amazon.co.jp", oldestDay: null, newestDay: null },
    { marketplaceName: "Amazon.com", oldestDay: "2026-10-03", newestDay: "2026-10-18" },
    { marketplaceName: "Amazon.de", oldestDay: "2026-10-16", newestDay: "2026-10-16" },
  ]);
  assert.equal(inventoryAge(ranges[1].oldestDay, now).overdue, true);
  assert.deepEqual(inventoryReportRanges(sources, "Amazon.com"), [ranges[1]]);
  assert.deepEqual(inventoryReportRanges(sources, "Amazon.fr"), []);
});

test("inventory empty states distinguish missing coverage, empty captures, company assignment and filtered matches", () => {
  const scope = { captures, marketplace: "Amazon.com", hasItems: false, member: false };
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: undefined }),
    "No inventory rows to show. Snapshot coverage has not been confirmed yet.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: [] }),
    "No inventory snapshot has been imported for Amazon.com.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: [], marketplace: "" }),
    "No inventory snapshots have been imported yet.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, marketplace: "Amazon.de" }),
    "No inventory snapshot has been imported for Amazon.de.",
  );
  assert.equal(
    inventoryEmptyMessage(scope),
    "The latest imported snapshots contain no inventory items in this marketplace scope.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, member: true }),
    "An inventory snapshot is available, but no items from it are assigned to your company.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, hasItems: true }),
    "No inventory matches these filters.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, hasItems: undefined }),
    "Checking inventory availability before these filters…",
  );
});
