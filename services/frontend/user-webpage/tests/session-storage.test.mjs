import assert from "node:assert/strict";
import test from "node:test";
import { createSessionStore, sessionStorageKey } from "../src/session-storage.ts";

const KEY = sessionStorageKey("https://project-a.example.invalid");

function session(overrides = {}) {
  return {
    access_token: "Synthetic.Access-A",
    refresh_token: "Synthetic.Refresh-A",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4600,
    user: { id: "User-A", email: "User.A@Example.test" },
    ...overrides,
  };
}

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const removed = [];
  const written = [];
  return {
    values,
    removed,
    written,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      written.push(key);
      values.set(key, value);
    },
    removeItem(key) {
      removed.push(key);
      values.delete(key);
    },
  };
}

test("relative expiry becomes absolute once and is not extended by later reads or writes", () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, KEY);
  const received = session({ expires_at: undefined });
  const original = structuredClone(received);
  const saved = store.write(received, 1_000_750);
  assert.equal(saved.expires_at, 4600);
  assert.equal(store.read().expires_at, 4600);
  assert.equal(store.write(saved, 9_000_000).expires_at, 4600);
  assert.equal(store.read().expires_at, 4600);
  assert.deepEqual(received, original);
});

test("only session credentials, expiry, and minimal user identity are persisted", () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, KEY);
  const expected = session();
  const supplied = {
    ...expected,
    password: "synthetic-password-must-not-be-saved",
    account: { access_role: "operator", company_id: "cached-company" },
    companies: [{ id: "cached-company", name: "Cached company" }],
    assignments: [{ sku: "cached-sku" }],
    user: {
      ...expected.user,
      password: "also-not-saved",
      app_metadata: { role: "operator" },
      user_metadata: { company: "cached-company" },
      identities: [{ provider: "email" }],
    },
  };
  assert.deepEqual(store.write(supplied), expected);
  assert.deepEqual(JSON.parse(storage.values.get(KEY)), expected);
  assert.deepEqual(store.read(), expected);
  assert.equal(storage.values.size, 1);
});

test("reading stored records ignores untrusted account and user metadata", () => {
  const expected = session();
  const storage = memoryStorage({
    [KEY]: JSON.stringify({
      ...expected,
      account: { access_role: "operator" },
      password: "not-restored",
      user: { ...expected.user, app_metadata: { role: "operator" } },
    }),
  });
  assert.deepEqual(createSessionStore(storage, KEY).read(), expected);
});

test("malformed records and missing absolute expiry are removed without clearing other storage", () => {
  const invalid = [
    "not JSON",
    "null",
    "[]",
    "{}",
    JSON.stringify(session({ expires_at: undefined })),
    JSON.stringify(session({ expires_at: 0 })),
    JSON.stringify(session({ expires_at: -1 })),
    JSON.stringify(session({ expires_at: "4600" })),
    JSON.stringify(session()).replace('"expires_at":4600', '"expires_at":1e999'),
    JSON.stringify(session({ expires_in: 0 })),
    JSON.stringify(session({ token_type: "basic" })),
    JSON.stringify(session({ access_token: " " })),
    JSON.stringify(session({ refresh_token: "" })),
    JSON.stringify(session({ user: null })),
    JSON.stringify(session({ user: { id: " " } })),
    JSON.stringify(session({ user: { id: "User-A", email: 7 } })),
  ];
  for (const raw of invalid) {
    const storage = memoryStorage({ [KEY]: raw, unrelated: "preserved" });
    assert.equal(createSessionStore(storage, KEY).read(), null);
    assert.deepEqual(storage.removed, [KEY]);
    assert.equal(storage.values.has(KEY), false);
    assert.equal(storage.values.get("unrelated"), "preserved");
  }
});

test("expired access credentials remain available for refresh and missing storage stays empty", () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, KEY);
  assert.equal(store.read(), null);
  assert.deepEqual(storage.removed, []);
  const expired = session({ expires_at: 1 });
  store.write(expired, 99_000_000);
  assert.deepEqual(store.read(), expired);
  assert.deepEqual(storage.removed, []);
});

test("storage keys isolate Supabase projects and local ports", () => {
  const keyA = sessionStorageKey("https://project-a.example.invalid/");
  const keyB = sessionStorageKey("https://project-b.example.invalid");
  assert.equal(keyA, KEY);
  assert.equal(sessionStorageKey("https://project-a.example.invalid///"), KEY);
  assert.notEqual(keyA, keyB);
  assert.notEqual(
    sessionStorageKey("http://127.0.0.1:54321"),
    sessionStorageKey("http://127.0.0.1:55421"),
  );
  const storage = memoryStorage();
  const storeA = createSessionStore(storage, keyA);
  const storeB = createSessionStore(storage, keyB);
  const other = session({
    access_token: "Synthetic.Access-B",
    refresh_token: "Synthetic.Refresh-B",
    user: { id: "User-B" },
  });
  storeA.write(session());
  storeB.write(other);
  storeA.clear();
  assert.equal(storeA.read(), null);
  assert.deepEqual(storeB.read(), other);
  assert.deepEqual(storage.removed, [keyA]);
});

test("unavailable or denied browser storage does not prevent an in-memory sign-in", () => {
  const denied = {
    getItem() {
      throw new Error("Storage denied");
    },
    setItem() {
      throw new Error("Storage denied");
    },
    removeItem() {
      throw new Error("Storage denied");
    },
  };
  for (const storage of [null, denied]) {
    const store = createSessionStore(storage, KEY);
    assert.equal(store.read(), null);
    assert.deepEqual(store.write(session()), session());
    assert.deepEqual(
      store.read(),
      session(),
      "An in-memory session can recover a temporary lookup failure",
    );
    assert.doesNotThrow(() => store.clear());
    assert.equal(store.read(), null);
  }
  const quotaDenied = memoryStorage();
  quotaDenied.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.deepEqual(createSessionStore(quotaDenied, KEY).write(session()), session());
  assert.equal(quotaDenied.values.size, 0);
});

test("failed persistence retains rotated credentials in memory and clearing cannot resurrect an old token", () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, KEY);
  store.write(session());
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  const rotated = session({
    access_token: "Synthetic.Access-B",
    refresh_token: "Synthetic.Refresh-B",
  });
  store.write(rotated);
  assert.deepEqual(store.read(), rotated);
  assert.equal(JSON.parse(storage.values.get(KEY)).access_token, "Synthetic.Access-A");
  storage.removeItem = () => {
    throw new Error("Storage denied");
  };
  store.clear();
  assert.equal(store.read(), null);
});

test("identity, token case, and optional email are preserved without normalization", () => {
  const store = createSessionStore(memoryStorage(), KEY);
  const original = session({
    token_type: "BEARER",
    user: { id: "USER-A.Mixed_Ω", email: "Mixed.Case@Example.test" },
  });
  assert.deepEqual(store.write(original), original);
  assert.deepEqual(store.read(), original);
  const withoutEmail = session({ user: { id: "USER-B" } });
  store.write(withoutEmail);
  assert.deepEqual(store.read(), withoutEmail);
  assert.equal(Object.hasOwn(store.read().user, "email"), false);
});

test("invalid incoming sessions fail before replacing a valid stored credential", () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage, KEY);
  store.write(session());
  for (const change of [
    { expires_at: 0 },
    { expires_in: -1 },
    { user: {} },
    { refresh_token: "" },
  ]) {
    assert.throws(() => store.write(session(change)), /invalid session/);
  }
  assert.deepEqual(storage.written, [KEY]);
  assert.deepEqual(store.read(), session());
});
