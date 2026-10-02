import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceStore,
  clearWorkspaceStorage,
  workspaceStoragePrefix,
} from "../src/workspace-storage.ts";
import {
  decodeDatasetViews,
  decodeFeeView,
  decodeInventoryView,
  decodeWorkspaceTab,
} from "../src/workspace-view-codec.ts";
import { createFeeViewState } from "../src/workspace-view-state.ts";

const account = { user_id: "account-a", access_role: "operator", company_id: null };
function storage() {
  const data = new Map();
  return {
    data,
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}
const text = (value) => (typeof value === "string" ? value : "default");
const prefix = workspaceStoragePrefix("https://project.example/");

test("workspace restores in the same project and account and isolates permissions and other projects", () => {
  const saved = storage();
  createWorkspaceStore(saved, prefix, account).write("tab", "fees");
  assert.equal(
    createWorkspaceStore(saved, prefix, account).read("tab", () => "default", text),
    "fees",
  );
  const otherPrefix = workspaceStoragePrefix("https://other.example");
  const otherProject = createWorkspaceStore(saved, otherPrefix, account);
  assert.equal(
    otherProject.read("tab", () => "default", text),
    "default",
  );
  otherProject.write("tab", "inventory");
  const changed = createWorkspaceStore(saved, prefix, {
    ...account,
    access_role: "company_member",
    company_id: "company-a",
  });
  assert.equal(
    changed.read("tab", () => "default", text),
    "default",
  );
  assert.equal(
    otherProject.read("tab", () => "default", text),
    "inventory",
  );
});

test("clearing a session prevents old asynchronous writes from restoring drafts even for the same account", () => {
  const saved = storage();
  const old = createWorkspaceStore(saved, prefix, account);
  old.write("fees", "old draft");
  clearWorkspaceStorage(saved, prefix);
  const fresh = createWorkspaceStore(saved, prefix, account);
  old.write("fees", "late save result");
  assert.equal(
    fresh.read("fees", () => "default", text),
    "default",
  );
  fresh.write("fees", "new draft");
  old.write("fees", "late save result again");
  assert.equal(
    fresh.read("fees", () => "default", text),
    "new draft",
  );
});

test("corrupt, oversized and blocked browser storage falls back without crashing", () => {
  const saved = storage();
  const store = createWorkspaceStore(saved, prefix, account);
  store.write("tab", "fees");
  const key = [...saved.data.keys()].find((key) => key.endsWith(":tab"));
  saved.data.set(key, "not json");
  assert.equal(
    createWorkspaceStore(saved, prefix, account).read("tab", () => "default", text),
    "default",
  );
  store.write("tab", "x".repeat(2_000_001));
  assert.equal(saved.data.has(key), false);
  assert.equal(store.getPersistenceFailed(), true);
  const blocked = createWorkspaceStore(null, prefix, account);
  assert.equal(blocked.getPersistenceFailed(), true);
  blocked.write("tab", "inventory");
  assert.equal(
    blocked.read("tab", () => "default", text),
    "inventory",
  );
});

test("an actual write failure notifies once and retains current in-memory edits", () => {
  const saved = storage();
  const store = createWorkspaceStore(saved, prefix, account);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  store.write("fees", "original");
  assert.equal(store.getPersistenceFailed(), false);
  saved.setItem = () => {
    throw new DOMException("Synthetic quota failure", "QuotaExceededError");
  };
  store.write("fees", "edited draft");
  store.write("fees", "newer edited draft");
  assert.equal(store.getPersistenceFailed(), true);
  assert.equal(notifications, 1);
  assert.equal(
    store.read("fees", () => "default", text),
    "newer edited draft",
  );
  unsubscribe();
});

test("pagehide suspends writes, pageshow resumes them, and old activations remain invalid", () => {
  const saved = storage();
  const store = createWorkspaceStore(saved, prefix, account);
  store.write("tab", "fees");
  store.setSuspended(true);
  store.write("tab", "aborted callback");
  assert.equal(
    store.read("tab", () => "default", text),
    "fees",
  );
  store.setSuspended(false);
  store.write("tab", "inventory");
  assert.equal(
    createWorkspaceStore(saved, prefix, account).read("tab", () => "default", text),
    "inventory",
  );
  clearWorkspaceStorage(saved, prefix);
  const next = createWorkspaceStore(saved, prefix, account);
  store.setSuspended(false);
  store.write("tab", "stale callback");
  assert.equal(
    next.read("tab", () => "default", text),
    "default",
  );
});

test("view decoders whitelist table controls and preserve exact SKU text", () => {
  const value = decodeDatasetViews({
    live: {
      search: "sku",
      pagination: { pageIndex: -1, pageSize: 5000 },
      sorting: [{ id: "unsafe", desc: true }],
      filters: { skus: [" padded SKU ", 12], reportHistory: true },
      selectedRowId: "settlement:one",
      access_token: "discarded",
    },
    invented: {},
  });
  assert.equal(value.live.pagination.pageIndex, 0);
  assert.equal(value.live.pagination.pageSize, 25);
  assert.deepEqual(value.live.sorting, [{ id: "activity_date", desc: true }]);
  assert.deepEqual(value.live.filters.skus, [" padded SKU "]);
  assert.equal(value.live.selectedRowId, "settlement:one");
  assert.equal("access_token" in value.live, false);
  assert.equal("invented" in value, false);
  assert.equal(
    decodeWorkspaceTab("accounts", { ...account, access_role: "company_member" }),
    "live",
  );
  assert.equal(decodeWorkspaceTab("financial-review", account), "financial-review");
  assert.equal(
    decodeWorkspaceTab("financial-review", { ...account, access_role: "company_member" }),
    "live",
  );
  assert.deepEqual(
    decodeInventoryView({ healthStatuses: [null, "low", 1], sortColumn: "unsafe" }).healthStatuses,
    [null, "low"],
  );
  assert.equal(decodeInventoryView({ sortColumn: "unsafe" }).sortColumn, "sku");
  const inventory = decodeInventoryView({
    selectedRowId: '["capture","SKU"]',
    expanded: ["old"],
    available_quantity: "42",
  });
  assert.equal(inventory.selectedRowId, '["capture","SKU"]');
  assert.equal("expanded" in inventory, false);
  assert.equal("available_quantity" in inventory, false);
});

test("saved payout lists restore month grouping and discard the removed global history filter", () => {
  const { payouts } = decodeDatasetViews({
    payouts: {
      sorting: [{ id: "created_at", desc: false }],
      filters: { reportHistory: true, dateFrom: "2026-07-01", dateTo: "2026-07-01" },
    },
  });
  assert.deepEqual(payouts.sorting, [{ id: "start_date", desc: true }]);
  assert.equal("reportHistory" in payouts.filters, false);
  assert.equal(payouts.filters.dateFrom, "2026-07-01");
});

test("interrupted saves preserve drafts and optimistic versions without replaying a pending mutation", () => {
  const form = {
    sku: "S1",
    company_id: "company-a",
    expected_current_version_id: "original-version",
    periods: [
      {
        marketplace_name: "Amazon.com",
        valid_from: "",
        valid_to: null,
        fee_rate_percent: "invalid unfinished",
      },
    ],
  };
  const value = decodeFeeView({
    ...createFeeViewState(),
    drafts: [form],
    editing: { sku: "S1", isNew: false, form, submitError: null },
    reviewing: true,
    savePending: true,
    changeReason: "my reason",
  });
  assert.deepEqual(value.drafts, [form]);
  assert.deepEqual(value.editing.form, form);
  assert.equal(value.changeReason, "my reason");
  assert.equal(value.reviewing, true);
  assert.equal(value.requiresReload, true);
  assert.equal(value.savePending, false);
  assert.match(value.saveProblem, /before the save was confirmed/);
  assert.deepEqual(decodeFeeView({ drafts: [{ sku: "missing expected version" }] }).drafts, []);
});
