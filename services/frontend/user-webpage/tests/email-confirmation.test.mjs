import assert from "node:assert/strict";
import test from "node:test";
import { readEmailConfirmation } from "../src/email-confirmation.ts";

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
    readEmailConfirmation(fragment({ ...tokens, user_id: "forged-user", role: "administrator" })),
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: "bearer",
      expires_in: 3600,
    },
  );
  assert.equal(readEmailConfirmation("#some-section"), null);
  assert.equal(
    readEmailConfirmation(fragment({ ...tokens, expires_at: "1800000000" })).expires_at,
    1800000000,
  );
});

test("malformed or unrelated Auth sessions cannot be accepted as email signup confirmation", () => {
  for (const patch of [
    { expires_in: "NaN" },
    { expires_in: "0" },
    { expires_at: "NaN" },
    { refresh_token: "" },
    { type: "recovery" },
    { token_type: "other" },
  ]) {
    assert.throws(
      () => readEmailConfirmation(fragment({ ...tokens, ...patch })),
      /could not be verified/,
    );
  }
});

test("confirmation errors do not render an untrusted Auth error description", () => {
  assert.throws(
    () =>
      readEmailConfirmation(
        fragment({ error: "access_denied", error_description: "private server details" }),
      ),
    (error) => {
      assert.match(error.message, /invalid or has expired/);
      assert.equal(error.message.includes("private server details"), false);
      return true;
    },
  );
});
