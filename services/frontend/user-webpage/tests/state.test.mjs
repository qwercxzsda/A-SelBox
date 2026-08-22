import assert from "node:assert/strict";
import test from "node:test";
import { lastPageIndex } from "../src/pagination.ts";
import { sessionRefreshDelayMs } from "../src/session.ts";

const SESSION = {
  access_token: "local-access-token",
  expires_in: 3_600,
  refresh_token: "local-refresh-token",
  token_type: "bearer",
  user: { id: "local-user" },
};

test("computes and clamps the last available page", () => {
  assert.equal(lastPageIndex(0, 25), 0);
  assert.equal(lastPageIndex(1, 25), 0);
  assert.equal(lastPageIndex(50, 25), 1);
  assert.equal(lastPageIndex(51, 25), 2);
});

test("refreshes a session one minute before expiry", () => {
  const nowMs = 2_000_000;
  assert.equal(sessionRefreshDelayMs(SESSION, nowMs), 3_540_000);
  assert.equal(sessionRefreshDelayMs({ ...SESSION, expires_at: nowMs / 1_000 + 30 }, nowMs), 0);
});
