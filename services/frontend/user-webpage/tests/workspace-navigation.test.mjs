import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory } from "@tanstack/react-router";
import { createWorkspaceNavigation } from "../src/workspace-navigation.ts";
import { createWorkspaceStore } from "../src/workspace-storage.ts";
import { createDatasetViewState, createInventoryViewState } from "../src/workspace-view-state.ts";
import { decodeDatasetViews, decodeWorkspaceTab } from "../src/workspace-view-codec.ts";

const account = { user_id: "reviewer", access_role: "administrator", company_id: null };

function workspace() {
  const history = createMemoryHistory({ initialEntries: ["/app?campaign=initial#notes"] });
  const navigations = [];
  const router = {
    history,
    origin: "https://example.test",
    navigate(options) {
      navigations.push(options);
      history[options.replace ? "replace" : "push"](options.href);
      return Promise.resolve();
    },
  };
  const navigation = createWorkspaceNavigation(
    createWorkspaceStore(null, "", account),
    account,
    router,
  );
  navigation.store.read(
    "tab",
    () => "live",
    (value) => decodeWorkspaceTab(value, account),
  );
  navigation.store.read("datasets", () => ({}), decodeDatasetViews);
  const dispose = navigation.initialize();
  navigations.length = 0;
  return { navigation, history, navigations, dispose };
}

test("workspace writes preserve the router's latest unrelated query parameters and fragment", async () => {
  const { navigation, history } = workspace();
  const current = new URL(history.location.href, "https://example.test");
  current.searchParams.set("campaign", "updated");
  current.hash = "instructions";
  history.replace(`${current.pathname}${current.search}${current.hash}`);
  navigation.store.write("datasets", {
    live: { ...createDatasetViewState("live"), search: "literal+001" },
  });
  await Promise.resolve();
  const result = new URL(history.location.href, "https://example.test");
  assert.equal(result.searchParams.get("campaign"), "updated");
  assert.equal(result.hash, "#instructions");
  assert.equal(result.searchParams.get("search"), "literal+001");
});

test("one interaction batches navigation and suspended or disposed workspaces cannot commit", async () => {
  const { navigation, navigations, dispose } = workspace();
  navigation.store.write("tab", "inventory");
  navigation.store.write("inventory", { ...createInventoryViewState(), search: "SKU" });
  await Promise.resolve();
  assert.equal(navigations.length, 1);
  assert.match(navigations[0].href, /tab=inventory/);
  assert.match(navigations[0].href, /search=SKU/);
  navigation.store.setSuspended(true);
  navigation.store.write("tab", "live");
  await Promise.resolve();
  assert.equal(navigations.length, 1);
  navigation.store.setSuspended(false);
  navigation.store.write("tab", "live");
  dispose();
  await Promise.resolve();
  assert.equal(navigations.length, 1);
});

test("history traversal restores navigation once and unsubscribed workspaces stop receiving events", () => {
  const { navigation, history } = workspace();
  let notifications = 0;
  const unsubscribe = navigation.subscribe(() => notifications++);
  history.push("/app?tab=inventory");
  history.push("/app?tab=companies");
  assert.equal(navigation.getRevision(), 0);
  history.back();
  assert.equal(navigation.getRevision(), 1);
  assert.equal(notifications, 1);
  assert.equal(
    navigation.store.read(
      "tab",
      () => "live",
      (value) => value,
    ),
    "inventory",
  );
  unsubscribe();
  history.back();
  assert.equal(notifications, 1);
});
