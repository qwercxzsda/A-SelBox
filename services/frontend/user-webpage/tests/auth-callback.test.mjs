import assert from "node:assert/strict";
import test from "node:test";
import { readAuthCallback, takeAuthCallback } from "../src/auth-callback.ts";

const tokens = {
  access_token: "confirmation-access",
  refresh_token: "confirmation-refresh",
  token_type: "bearer",
  expires_in: "3600",
  type: "signup",
};
const fragment = (values) => `#${new URLSearchParams(values)}`;

test("confirmation reads only session tokens, leaving identity verification to Auth", () => {
  assert.deepEqual(
    readAuthCallback(fragment({ ...tokens, user_id: "forged-user", role: "administrator" })),
    {
      kind: "signup",
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: "bearer",
        expires_in: 3600,
      },
    },
  );
  assert.equal(readAuthCallback("#some-section"), null);
  assert.equal(
    readAuthCallback(fragment({ ...tokens, expires_at: "1800000000" })).tokens.expires_at,
    1800000000,
  );
});

test("malformed or unrelated Auth sessions cannot be accepted as email signup confirmation", () => {
  for (const patch of [
    { expires_in: "NaN" },
    { expires_in: "0" },
    { expires_at: "NaN" },
    { refresh_token: "" },
    { type: "magiclink" },
    { token_type: "other" },
  ]) {
    assert.throws(
      () => readAuthCallback(fragment({ ...tokens, ...patch })),
      /could not be verified/,
    );
  }
});

test("confirmation errors do not render an untrusted Auth error description", () => {
  assert.throws(
    () =>
      readAuthCallback(
        fragment({ error: "access_denied", error_description: "private server details" }),
      ),
    (error) => {
      assert.match(error.message, /invalid or has expired/);
      assert.equal(error.message.includes("private server details"), false);
      return true;
    },
  );
});

test("recovery callbacks keep their purpose but do not accept identity or role claims", () => {
  const result = readAuthCallback(
    fragment({ ...tokens, type: "recovery", user_id: "forged", role: "administrator" }),
  );
  assert.equal(result.kind, "recovery");
  assert.equal(result.tokens.access_token, tokens.access_token);
  assert.equal("user_id" in result.tokens, false);
  assert.equal("role" in result.tokens, false);
  assert.throws(
    () => readAuthCallback(fragment(tokens) + "&type=recovery"),
    /could not be verified/,
  );
  assert.throws(() => readAuthCallback("#refresh_token=secret-only"), /could not be verified/);
});

test("callback consumption removes secrets and errors before parsing, preserving workspace query state", () => {
  const original = globalThis.window;
  try {
    for (const hash of [
      fragment({ ...tokens, type: "recovery" }),
      "#error_description=do-not-display",
      "#refresh_token=partial-secret",
    ]) {
      let destination;
      globalThis.window = {
        location: { pathname: "/", search: "?tab=inventory", hash },
        history: {
          state: { existing: true },
          replaceState(state, _title, path) {
            destination = path;
            assert.deepEqual(state, { existing: true });
            globalThis.window.location.hash = "";
          },
        },
      };
      try {
        takeAuthCallback();
      } catch {
        /* Invalid callbacks still must be stripped. */
      }
      assert.equal(destination, "/?tab=inventory");
      assert.equal(globalThis.window.location.hash, "");
    }
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
