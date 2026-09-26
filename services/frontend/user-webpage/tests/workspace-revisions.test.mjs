import assert from "node:assert/strict";
import test from "node:test";
import { QueryObserver } from "@tanstack/react-query";
import { createApiClient } from "../src/api/client.ts";
import { createQueryClient } from "../src/query-client.ts";
import {
  activeRevisionSources,
  changedRevisionSources,
  queryRevisionSources,
  refreshWorkspaceQueries,
  isAdministrativeDataset,
  isAdministrativeQuery,
  sameAccount,
} from "../src/workspace-revisions.ts";

const SETTINGS = { supabaseUrl: "https://example.invalid", publishableKey: "sb_publishable_test" };
const account = { user_id: "user-a", access_role: "company_member", company_id: "company-a" };
const options = {
  accessToken: "private-test-token",
  userId: "user-a",
  sources: ["settlement", "fees"],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("poll requests only named revisions through authenticated REST, without counts or company overrides", async () => {
  let captured;
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (url, init) => {
    captured = { url: new URL(url), init };
    return json({
      account,
      revisions: { settlement: "opaque-token", fees: "9007199254740993", data_kiosk: "ignored" },
    });
  });
  assert.deepEqual(
    await client.fetchWorkspaceRevisions({ ...options, signal: controller.signal }),
    {
      account,
      revisions: { settlement: "opaque-token", fees: "9007199254740993" },
    },
  );
  assert.equal(captured.url.pathname, "/rest/v1/rpc/workspace_revisions");
  assert.deepEqual([...captured.url.searchParams], [["p_sources", "{settlement,fees}"]]);
  assert.equal(captured.init.headers.Authorization, "Bearer private-test-token");
  assert.equal(captured.init.headers.Prefer, undefined);
  assert.equal(captured.init.cache, "no-store");
  assert.equal(captured.init.signal, controller.signal);
  assert.equal(captured.init.redirect, "error");
});

test("poll rejects omitted/malformed revisions, another user's account, and unauthorized responses", async () => {
  for (const body of [
    {},
    { account, revisions: { settlement: "1" } },
    { account, revisions: { settlement: 1, fees: "1" } },
    { account, revisions: { settlement: "1", fees: " " } },
    { account: { ...account, user_id: "user-b" }, revisions: { settlement: "1", fees: "1" } },
    ...[
      { ...account, access_role: "unregistered" },
      { ...account, company_id: null },
      { ...account, access_role: "operator" },
    ].map((invalidAccount) => ({
      account: invalidAccount,
      revisions: { settlement: "1", fees: "1" },
    })),
  ]) {
    const client = createApiClient(SETTINGS, async () => json(body));
    await assert.rejects(client.fetchWorkspaceRevisions(options));
  }
  for (const status of [401, 403, 503]) {
    const client = createApiClient(SETTINGS, async () =>
      json({ message: "private SQL error" }, status),
    );
    await assert.rejects(client.fetchWorkspaceRevisions(options), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private SQL error"), false);
      return true;
    });
  }
});

test("changed opaque tokens are compared only for requested sources, including newly observed sources", () => {
  assert.deepEqual(
    changedRevisionSources({ settlement: "old", fees: "same" }, { fees: "same" }),
    [],
  );
  assert.deepEqual(
    changedRevisionSources(
      { settlement: "zzz", fees: "same" },
      { settlement: "aaa", fees: "same" },
    ),
    ["settlement"],
  );
  assert.deepEqual(changedRevisionSources({ fees: "same" }, { data_kiosk: "0" }), ["data_kiosk"]);
  assert.equal(sameAccount(account, { ...account }), true);
  assert.equal(sameAccount(account, { ...account, company_id: "company-b" }), false);
  assert.equal(
    sameAccount(account, { ...account, access_role: "operator", company_id: null }),
    false,
  );
});

test("pages, choices, counts, cards and fees carry the correct source dependencies", () => {
  for (const family of ["dataset", "dataset-options", "dataset-count"]) {
    assert.deepEqual(queryRevisionSources([family, "u", "operator", null, "settlement"]), [
      "settlement",
    ]);
    assert.deepEqual(queryRevisionSources([family, "u", "operator", null, "data_kiosk"]), [
      "data_kiosk",
    ]);
    assert.deepEqual(queryRevisionSources([family, "u", "company_member", "a", "settlement"]), [
      "settlement",
      "fees",
    ]);
    assert.deepEqual(queryRevisionSources([family, "u", "operator", null, "live"]), [
      "settlement",
      "data_kiosk",
      "fees",
    ]);
  }
  assert.deepEqual(queryRevisionSources(["dataset-count", "u", "operator", null, "settlement"]), [
    "settlement",
  ]);
  assert.deepEqual(queryRevisionSources(["current-fees", "u", "operator"]), ["fees"]);
  assert.deepEqual(queryRevisionSources(["transaction-type-totals"]), [
    "settlement",
    "data_kiosk",
    "fees",
  ]);
  assert.deepEqual(queryRevisionSources(["unrelated"]), []);
});

test("poll scope includes active observers and lookup fees, but excludes inactive cached tables", () => {
  const client = createQueryClient();
  client.setQueryData(["dataset", "u", "operator", null, "data_kiosk"], {});
  const observer = new QueryObserver(client, {
    queryKey: ["dataset", "u", "operator", null, "settlement"],
    queryFn: async () => ({}),
    initialData: {},
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.deepEqual(activeRevisionSources(client), ["settlement", "fees"]);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("administrative refresh policy applies only to account and payout pages and their counts", () => {
  for (const dataset of ["accounts", "payouts", "live", "settlement", "data_kiosk", "fees"]) {
    const expected = dataset === "accounts" || dataset === "payouts";
    assert.equal(isAdministrativeDataset(dataset), expected);
    for (const key of [
      ["dataset", "u", "operator", null, dataset],
      ["dataset-count", "u", "operator", null, dataset],
    ])
      assert.equal(isAdministrativeQuery({ queryKey: key }), expected);
    assert.equal(
      isAdministrativeQuery({ queryKey: ["unrelated", "u", "operator", null, dataset] }),
      false,
    );
  }
});

test("revision refresh invalidates matching counts and inactive pages but only fetches active non-count queries", async () => {
  const client = createQueryClient();
  const reads = [];
  const keys = [
    ["dataset", "u", "operator", null, "live"],
    ["dataset-count", "u", "operator", null, "live"],
    ["dataset", "u", "operator", null, "settlement"],
  ];
  const unsubscribers = keys.map((key) =>
    new QueryObserver(client, {
      queryKey: key,
      initialData: "cached",
      staleTime: Infinity,
      queryFn: async () => {
        reads.push(key);
        return "fresh";
      },
    }).subscribe(() => {}),
  );
  const inactive = ["dataset", "u", "operator", null, "live", "inactive"];
  client.setQueryData(inactive, "cached");
  try {
    await refreshWorkspaceQueries(client, ["fees"], false, new AbortController().signal);
    assert.deepEqual(reads, [keys[0]]);
    assert.equal(client.getQueryState(keys[1]).isInvalidated, true);
    assert.equal(client.getQueryState(inactive).isInvalidated, true);
    assert.equal(client.getQueryState(keys[2]).isInvalidated, false);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    client.clear();
  }
});

test("an aborted workspace refresh leaves cached data untouched", async () => {
  const client = createQueryClient();
  const key = ["dataset", "u", "operator", null, "live"];
  client.setQueryData(key, "cached");
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(refreshWorkspaceQueries(client, ["fees"], false, controller.signal), {
      name: "AbortError",
    });
    assert.equal(client.getQueryState(key).isInvalidated, false);
  } finally {
    client.clear();
  }
});
