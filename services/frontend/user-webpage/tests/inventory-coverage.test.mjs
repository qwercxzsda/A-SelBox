import assert from "node:assert/strict";
import test from "node:test";
import timeZones from "../src/generated/marketplace-timezones.json" with { type: "json" };
import marketplaces from "../src/generated/marketplaces.json" with { type: "json" };
import {
  inventoryAge,
  inventoryEmptyMessage,
  inventorySourceDay,
} from "../src/inventory-coverage.ts";

const now = Date.parse("2026-10-18T12:00:00Z");
const captures = [{ marketplace_name: "Amazon.com" }];

test("every selectable marketplace has one valid source-defined time zone", () => {
  assert.deepEqual(Object.keys(timeZones).sort(), marketplaces);
  for (const timeZone of Object.values(timeZones))
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone }));
  assert.equal(timeZones["Non-Amazon IT"], "Europe/Rome");
});

test("inventory freshness uses the marketplace calendar across UTC boundaries", () => {
  const refreshed = Date.parse("2026-11-05T17:15:00Z");
  for (const marketplace of ["Amazon.co.jp", "Amazon.com.au", "Amazon.sg"]) {
    assert.deepEqual(inventoryAge("2026-11-06", refreshed, marketplace), {
      label: "Today",
      compactLabel: "Today",
      overdue: false,
    });
    assert.deepEqual(inventoryAge("2026-11-03", refreshed, marketplace), {
      label: "3 days old",
      compactLabel: "3d ago",
      overdue: true,
    });
    assert.equal(
      inventoryAge("2026-11-07", refreshed, marketplace).label,
      "Future source date — check source",
    );
  }
  assert.equal(
    inventoryAge("2026-11-06", refreshed, "Amazon.com").label,
    "Future source date — check source",
  );
  assert.deepEqual(inventoryAge("2026-11-05", Date.parse("2026-11-06T02:00:00Z"), "Amazon.com"), {
    label: "Today",
    compactLabel: "Today",
    overdue: false,
  });
});

test("report timestamps use marketplace dates and calendar-day age survives daylight-saving changes", () => {
  assert.equal(inventorySourceDay("2026-11-05T17:15:00Z", "Amazon.sg"), "2026-11-06");
  assert.equal(inventorySourceDay("2026-11-06T02:00:00Z", "Amazon.com"), "2026-11-05");
  assert.equal(inventorySourceDay("2026-11-06", "Amazon.com"), "2026-11-06");
  assert.equal(
    inventoryAge("2026-10-23", Date.parse("2026-10-25T22:59:59Z"), "Amazon.de").overdue,
    false,
  );
  assert.equal(
    inventoryAge("2026-10-23", Date.parse("2026-10-25T23:00:00Z"), "Amazon.de").overdue,
    true,
  );
});

test("inventory age uses source days, normalizes timestamp zones and flags overdue daily sources", () => {
  assert.deepEqual(inventoryAge("2026-10-18", now, "Amazon.com"), {
    label: "Today",
    compactLabel: "Today",
    overdue: false,
  });
  assert.deepEqual(inventoryAge("2026-10-16", now, "Amazon.com"), {
    label: "2 days old",
    compactLabel: "2d ago",
    overdue: false,
  });
  assert.deepEqual(inventoryAge("2026-10-15", now, "Amazon.com"), {
    label: "3 days old",
    compactLabel: "3d ago",
    overdue: true,
  });
  assert.deepEqual(inventoryAge("2026-10-03", now, "Amazon.com"), {
    label: "15 days old",
    compactLabel: "15d ago",
    overdue: true,
  });
  assert.equal(inventorySourceDay("2026-10-18T00:30:00+02:00", "Amazon.de"), "2026-10-18");
  assert.equal(inventorySourceDay("2026-10-18 23:30:00-02", "Amazon.com"), "2026-10-18");
  assert.equal(inventorySourceDay("2026-02-30", "Amazon.com"), null);
  assert.equal(inventoryAge(null, now, "Amazon.com").label, "Date unavailable");
  assert.deepEqual(inventoryAge("2026-10-19", now, "Amazon.com"), {
    label: "Future source date — check source",
    compactLabel: "Future date",
    overdue: false,
  });
});

test("unknown marketplaces and invalid clock values remain unavailable without a time-zone guess", () => {
  assert.equal(inventorySourceDay("2026-11-06", "Unknown marketplace"), null);
  assert.equal(inventoryAge("2026-11-06", now, "Unknown marketplace").label, "Date unavailable");
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 1e100, -1e100]) {
    assert.deepEqual(inventoryAge("2026-11-06", invalid, "Amazon.co.jp"), {
      label: "Date unavailable",
      compactLabel: "Date unavailable",
      overdue: false,
    });
  }
});

test("inventory empty states distinguish missing coverage, empty captures, company assignment and filtered matches", () => {
  const scope = { captures, marketplaces: ["Amazon.com"], hasItems: false, member: false };
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: undefined }),
    "Checking inventory availability…",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: [] }),
    "No inventory snapshot has been imported for Amazon.com.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, captures: [], marketplaces: [] }),
    "No inventory snapshots have been imported yet.",
  );
  assert.equal(
    inventoryEmptyMessage({ ...scope, marketplaces: ["Amazon.de"] }),
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
