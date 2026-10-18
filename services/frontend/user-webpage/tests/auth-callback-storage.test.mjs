import assert from "node:assert/strict";
import test from "node:test";
import { createAuthCallbackStore } from "../src/auth-callback-storage.ts";

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const pending = {
  kind: "recovery",
  tokens: {
    access_token: "test-access",
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 3600,
  },
};

test("pending recovery and verified flow survive F5 without password fields or cached permissions", () => {
  const disk = storage();
  const first = createAuthCallbackStore(disk, "callback");
  first.write({
    pending: {
      ...pending,
      password: "must-not-persist",
      tokens: { ...pending.tokens, role: "administrator" },
    },
    recovery: null,
  });
  assert.deepEqual(createAuthCallbackStore(disk, "callback").read(), { pending, recovery: null });
  assert.equal(disk.values.get("callback").includes("must-not-persist"), false);
  assert.equal(disk.values.get("callback").includes("administrator"), false);
  first.write({
    pending: null,
    recovery: { stage: "password", userId: "verified-user", password: "must-not-persist" },
  });
  assert.deepEqual(createAuthCallbackStore(disk, "callback").read(), {
    pending: null,
    recovery: { stage: "password", userId: "verified-user" },
  });
  assert.equal(disk.values.get("callback").includes("must-not-persist"), false);
  first.clear();
  assert.equal(disk.values.has("callback"), false);
});

test("invalid stored callbacks never restore stale tokens and restricted storage stays memory-only", () => {
  const disk = storage();
  const flow = createAuthCallbackStore(disk, "callback");
  flow.write({ pending, recovery: null });
  disk.values.set("callback", "invalid JSON");
  assert.deepEqual(flow.read(), { pending: null, recovery: null });
  disk.values.set(
    "callback",
    JSON.stringify({ pending: { ...pending, tokens: { ...pending.tokens, expires_in: 0 } } }),
  );
  assert.equal(flow.read().pending, null);
  const blocked = createAuthCallbackStore(
    {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    },
    "callback",
  );
  blocked.write({ pending, recovery: null });
  assert.deepEqual(blocked.read().pending, pending);
  blocked.clear();
  assert.equal(blocked.read().pending, null);
});
